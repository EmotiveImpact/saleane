#!/bin/sh
# Points the homepage's sign-up buttons at the app's account creation page (run after regenerating web/index.html).
sed -i 's|<a href="#" class="signin">|<a href="/account" class="signin">|; s|class="pill" href="#price"|class="pill" href="/account?create"|; s|<a class="btn dark" href="#">Start your free 14 days|<a class="btn dark" href="/account?create">Start your free 14 days|; s|<a class="btn" href="#price">Start free|<a class="btn" href="/account?create">Start free|; s|<a class="btn" href="#price" style="display: inline-block; color: #18201c">Start free|<a class="btn" href="/account?create" style="display: inline-block; color: #18201c">Start free|' "$1"
# Try the demo link in the top bar (fictional Codex demo), added once.
grep -q 'href="/demo"' "$1" || sed -i 's|<a href="/account" class="signin">|<a href="/demo" class="signin" title="A fictional studio to click around">Try the demo</a><a href="/account" class="signin">|' "$1"
# Hero "Try the demo" button, visible on phones too, added once.
grep -q 'class="btn demo-cta"' "$1" || sed -i 's|<a class="btn" href="#night">Try the booking assistant</a>|&<a class="btn demo-cta" href="/demo" style="margin: 10px 0 0 0">Try the demo</a>|' "$1"
