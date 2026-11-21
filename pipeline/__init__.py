"""Bellhaven CRM Sync pipeline: scrape the operator site, match to CRM accounts, queue proposals for review.

The pipeline only ever READS from the CRM. Every write happens in the review app, after a human approves it.
"""
