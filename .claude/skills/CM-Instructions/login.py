"""
Automates login to mysat-qa using credentials from Windows Credential Manager.
Requires: pip install playwright keyring && playwright install chromium

Bootstrap once: python C:\\Users\\pkatakam\\.claude\\setup_credentials.py
"""

import sys
from datetime import datetime
from pathlib import Path

# Import the shared loader from the .claude root.
sys.path.insert(0, str(Path(r"C:\Users\pkatakam\.claude")))
from secrets_loader import get_web_credentials
from playwright.sync_api import sync_playwright

USERNAME, PASSWORD = get_web_credentials()

LOGIN_URL = "https://mysat-qa.satreg-nonprod.collegeboard.org/login"
CONSENT_URL = "https://uat-widget.consent-management-nonprod.collegeboard.org/"
LOG_PATH = Path(__file__).parent / "Output" / "login.log"


def log(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {msg}"
    print(line)
    with open(LOG_PATH, "a", encoding="utf-8") as f:
        f.write(line + "\n")


def login(page):
    log(f"Navigating to {LOGIN_URL}")
    page.goto(LOGIN_URL)
    page.wait_for_load_state("networkidle")

    log("Clicking Sign In")
    page.get_by_role("button", name="Sign In").click()
    page.wait_for_load_state("networkidle")

    log(f"Filling email: {USERNAME}")
    page.get_by_label("Email").fill(USERNAME)
    page.get_by_role("button", name="Continue").click()
    page.wait_for_load_state("networkidle")

    log("Filling password and submitting")
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign In").click()
    page.wait_for_load_state("networkidle")

    log(f"Login complete. Current URL: {page.url}")


def main():
    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    log("=== Login session started ===")

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context()

        page1 = context.new_page()
        login(page1)

        page2 = context.new_page()
        log(f"Navigating to {CONSENT_URL}")
        page2.goto(CONSENT_URL)
        page2.wait_for_load_state("networkidle")
        log(f"Consent page loaded. Current URL: {page2.url}")

        log("=== Session ready. Press Enter to close browsers ===")
        input("Press Enter to close browsers...")
        browser.close()
        log("=== Browsers closed ===")


if __name__ == "__main__":
    main()
