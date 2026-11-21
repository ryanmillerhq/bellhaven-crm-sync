import pytest

from pipeline.parsing import claimed_count, community_slug, directory_count, parse_address, split_offerings


class TestCommunitySlug:
    def test_relative_detail_link(self):
        assert community_slug("/communities/bellhaven-of-goshen") == "bellhaven-of-goshen"

    def test_absolute_detail_link(self):
        assert community_slug("https://x.example/communities/amberly-manor") == "amberly-manor"

    @pytest.mark.parametrize("href", ["/communities", "/communities?page=2", "/communities/", "/about", None, ""])
    def test_non_detail_links_are_ignored(self, href):
        assert community_slug(href) is None


class TestParseAddress:
    def test_two_line_address(self):
        assert parse_address("1800 N Blanchard St\nFindlay, OH 45840") == {
            "street": "1800 N Blanchard St", "city": "Findlay", "state": "OH", "zip": "45840"}

    def test_multi_word_city_and_zip_plus_four(self):
        got = parse_address("150 River St\nChagrin Falls, OH 44022-1234")
        assert got["city"] == "Chagrin Falls" and got["zip"] == "44022"

    def test_suite_line_is_kept_with_street(self):
        got = parse_address("118 Union Square Dr\nSuite 200\nNew Albany, OH 43054")
        assert got["street"] == "118 Union Square Dr, Suite 200"

    def test_blank_lines_and_crlf(self):
        assert parse_address("\r\n 3985 Broadway \r\n\r\nGrove City, OH 43123\r\n")["street"] == "3985 Broadway"

    @pytest.mark.parametrize("bad", ["", "Findlay, OH 45840", "1800 N Blanchard St", "Findlay OH"])
    def test_unrecognized_formats_raise(self, bad):
        with pytest.raises(ValueError):
            parse_address(bad)


class TestOfferings:
    def test_badges_cleaned_and_deduped(self):
        assert split_offerings(["Assisted Living", " Memory  Support ", "Assisted Living"]) == [
            "Assisted Living", "Memory Support"]

    def test_comma_blob_fallback(self):
        assert split_offerings(["Assisted Living, Memory Support"]) == ["Assisted Living", "Memory Support"]

    def test_ampersand_name_survives(self):
        assert split_offerings(["Short-Term Rehabilitation & Nursing"]) == ["Short-Term Rehabilitation & Nursing"]


class TestCounts:
    def test_homepage_claim(self):
        assert claimed_count("Today we proudly serve 35 communities and growing.") == 35

    def test_directory_header(self):
        assert directory_count("Page 1 of 3 · 34 communities listed") == 34

    def test_missing_counts(self):
        assert claimed_count("Welcome") is None and directory_count("Welcome") is None
