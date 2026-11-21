"""Selenium scraper for the Bellhaven community directory.

Flow:
1. Homepage: harvest community links. New communities can appear in homepage notices before (or instead of)
   the directory. Also read the claimed count.
2. Directory: click "Next" until it disappears. Guarded against sites that serve the last page again for
   out-of-range page numbers: stop when a page adds no new communities, and cap the page count.
3. Detail pages: read every field by its label. Detail pages are the source of truth; cards can be abbreviated.

No human-behavior simulation here, on purpose: this site has no bot detection. A source that resists automation
would get a human-like interaction layer plugged in at `_open()`.
"""
from __future__ import annotations

import logging
import time
from urllib.parse import urljoin

from selenium import webdriver
from selenium.common.exceptions import NoSuchElementException, StaleElementReferenceException, TimeoutException
from selenium.webdriver.common.by import By
from selenium.webdriver.remote.webdriver import WebDriver
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait

from .models import Location, ScrapeReport
from .parsing import claimed_count, community_slug, directory_count, parse_address, split_offerings
from .xpaths import FIELD_LABELS, XPATH

log = logging.getLogger(__name__)

MAX_DIRECTORY_PAGES = 50
PAGE_TIMEOUT_S = 15
POLITE_DELAY_S = 0.25


def make_driver(headless: bool = True) -> WebDriver:
    """Headless Chrome. Selenium Manager resolves a matching chromedriver automatically (local and CI)."""
    opts = webdriver.ChromeOptions()
    if headless:
        opts.add_argument("--headless=new")
    for arg in ("--window-size=1280,900", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage"):
        opts.add_argument(arg)
    driver = webdriver.Chrome(options=opts)
    driver.set_page_load_timeout(PAGE_TIMEOUT_S * 2)
    return driver


class BellhavenScraper:
    def __init__(self, base_url: str, driver: WebDriver):
        self.base = base_url.rstrip("/")
        self.d = driver
        self.wait = WebDriverWait(driver, PAGE_TIMEOUT_S)

    # ---------- navigation helpers ----------
    def _open(self, url: str) -> None:
        self.d.get(url)
        self.wait.until(EC.presence_of_element_located((By.XPATH, XPATH["body_text"])))
        time.sleep(POLITE_DELAY_S)

    def _body_text(self) -> str:
        return self.d.find_element(By.XPATH, XPATH["body_text"]).text

    def _community_links_on_page(self) -> dict[str, str]:
        """slug → absolute URL for every community link on the current page (document order, deduped)."""
        links: dict[str, str] = {}
        for a in self.d.find_elements(By.XPATH, XPATH["community_links"]):
            href = a.get_attribute("href")
            slug = community_slug(href)
            if slug and slug not in links:
                links[slug] = urljoin(self.base + "/", href)
        return links

    def _field(self, label_key: str):
        for label in FIELD_LABELS[label_key]:
            found = self.d.find_elements(By.XPATH, XPATH["detail_field"].format(label=label))
            if found:
                return found[0]
        return None

    # ---------- stages ----------
    def homepage(self) -> tuple[dict[str, str], int | None]:
        self._open(self.base + "/")
        return self._community_links_on_page(), claimed_count(self._body_text())

    def directory(self) -> tuple[dict[str, tuple[str, int]], int, int | None]:
        """Walk the directory via its Next button. Returns slug → (url, page_no), pages visited, listed count."""
        self._open(self.base + "/communities")
        listed = directory_count(self._body_text())
        found: dict[str, tuple[str, int]] = {}
        page = 1
        while True:
            new = {s: u for s, u in self._community_links_on_page().items() if s not in found}
            for slug, url in new.items():
                found[slug] = (url, page)
            log.info("directory page %d: %d new communities (%d total)", page, len(new), len(found))
            if page > 1 and not new:
                log.info("page %d added nothing new; stopping (site repeats its last page)", page)
                break
            nxt = self.d.find_elements(By.XPATH, XPATH["next_page"])
            if not nxt or page >= MAX_DIRECTORY_PAGES:
                break
            old_body = self.d.find_element(By.XPATH, XPATH["body_text"])
            nxt[0].click()
            try:  # wait for the old page to be replaced before reading the new one
                self.wait.until(EC.staleness_of(old_body))
            except TimeoutException:
                log.warning("next-page click did not navigate; stopping pagination")
                break
            time.sleep(POLITE_DELAY_S)
            page += 1
        return found, page, listed

    def detail(self, slug: str, url: str) -> Location:
        for attempt in (1, 2):
            try:
                self._open(url)
                name = self.d.find_element(By.XPATH, XPATH["detail_name"]).text.strip()
                addr_el = self._field("address")
                if addr_el is None:
                    raise ValueError(f"{slug}: no address field")
                addr = parse_address(addr_el.text)
                care_el = self._field("care")
                offerings: list[str] = []
                if care_el is not None:
                    badges = [b.text for b in care_el.find_elements(By.XPATH, XPATH["badges"])]
                    offerings = split_offerings(badges or [care_el.text])
                admin_el, phone_el = self._field("administrator"), self._field("phone")
                return Location(
                    slug=slug, url=url, name=name, **addr, care_offerings=offerings,
                    administrator=admin_el.text.strip() if admin_el is not None else "",
                    phone=phone_el.text.strip() if phone_el is not None else "",
                )
            except (TimeoutException, StaleElementReferenceException, NoSuchElementException):
                if attempt == 2:
                    raise
                log.warning("retrying %s", url)
        raise RuntimeError("unreachable")

    def probe(self, slug: str) -> Location | None:
        """Directly open a previously known community page that is no longer linked. None = page is gone."""
        try:
            return self.detail(slug, f"{self.base}/communities/{slug}")
        except Exception:
            return None

    def run(self, known_slugs: list[str] | tuple = ()) -> tuple[list[Location], ScrapeReport]:
        home_links, claimed = self.homepage()
        dir_links, pages, listed = self.directory()

        sources: dict[str, list[str]] = {s: [f"directory p{p}"] for s, (_, p) in dir_links.items()}
        urls = {s: u for s, (u, _) in dir_links.items()}
        homepage_only = [s for s in home_links if s not in dir_links]
        for s, u in home_links.items():
            sources.setdefault(s, []).append("homepage")
            urls.setdefault(s, u)

        locations: list[Location] = []
        warnings: list[str] = []
        failed: list[str] = []
        # Communities seen in the last good run but no longer linked anywhere (e.g. a homepage "new" notice rotated
        # off): probe their pages directly so a live community doesn't look "no longer listed".
        for slug in known_slugs:
            if slug in urls:
                continue
            loc = self.probe(slug)
            if loc is not None:
                loc.found_on = ["direct URL (no longer linked)"]
                locations.append(loc)
                warnings.append(f"{slug}: no longer linked from the homepage or directory, but its page is still live")
            else:
                log.info("previously known community %s is gone from the site", slug)
        for slug, url in urls.items():
            try:
                loc = self.detail(slug, url)
            except Exception as exc:  # keep going; one bad page shouldn't sink the run
                failed.append(f"{slug}: {exc}")
                log.exception("failed to scrape %s", url)
                continue
            loc.found_on = sources[slug]
            for fld in ("name", "street", "city", "state", "zip"):
                if not getattr(loc, fld):
                    warnings.append(f"{slug}: missing {fld}")
            if not loc.care_offerings:
                warnings.append(f"{slug}: no care offerings")
            locations.append(loc)

        if claimed is not None and claimed != len(locations):
            warnings.append(f"homepage claims {claimed} communities but {len(locations)} were scraped")
        if homepage_only:
            warnings.append(f"{len(homepage_only)} communit{'y is' if len(homepage_only) == 1 else 'ies are'} "
                            f"linked only from the homepage, not the directory: {', '.join(homepage_only)}")
        report = ScrapeReport(claimed_count=claimed, directory_count=listed, found_count=len(locations),
                              pages_visited=pages, homepage_only=homepage_only, warnings=warnings, failed=failed)
        return locations, report


def scrape(base_url: str, headless: bool = True, known_slugs: list[str] | tuple = ()) -> tuple[list[Location], ScrapeReport]:
    driver = make_driver(headless=headless)
    try:
        return BellhavenScraper(base_url, driver).run(known_slugs=known_slugs)
    finally:
        driver.quit()
