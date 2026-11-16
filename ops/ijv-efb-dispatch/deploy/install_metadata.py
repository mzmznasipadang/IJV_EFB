from pathlib import Path

import streamlit


# Social crawlers read the initial HTML without starting a Streamlit session.
index = Path(streamlit.__file__).parent / "static" / "index.html"
html = index.read_text(encoding="utf-8")
default_title = "<title>Streamlit</title>"
if html.count(default_title) != 1:
    raise SystemExit("Expected one Streamlit title in the installed HTML shell")

metadata = Path(__file__).with_name("metadata.html").read_text(encoding="utf-8")
index.write_text(html.replace(default_title, metadata.rstrip()), encoding="utf-8")
