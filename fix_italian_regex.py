import re

with open('src/lib/extractDateTime.ts', 'r', encoding='utf-8') as f:
    content = f.read()

# The fix: in extractDayNameTime, extend the negative lookahead from just
# ordinals (st|nd|rd|th) to also reject month names. When a bare digit
# like "5" is followed by a month name ("5 giugno"), it's a DAY NUMBER,
# not a time.  We also add a second negative lookahead for month names.
#
# Current:
#   (?!\d*\s*(?:st|nd|rd|th)\b)/i;
#
# We add after it:
#   (?!\s*(?:jan(?:uary)?|feb(?:ruary)?|...|gennaio|...)\b)/i;

# Build month names from the MONTHS dict keys in the file
month_match = re.search(r'const MONTHS.*?\n(\s*\});', content, re.DOTALL)
# Just hardcode the month names since we know them
month_names = (
    r"jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|"
    r"jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|"
    r"dec(?:ember)?|gennaio|gen|febbraio|marzo|aprile|maggio|mag|giugno|giu|"
    r"luglio|lug|agosto|ago|settembre|set|ottobre|ott|novembre|dicembre|dic|"
    r"enero|ene|febrero|abril|mayo|junio|julio|septiembre|octubre|noviembre|"
    r"diciembre"
)

# Find the extractDayNameTime regex line and replace the negative lookahead
old_lookahead = r"(?!\d*\s*(?:st|nd|rd|th)\b)/i;"
new_lookahead = f"(?!\d*\\s*(?:st|nd|rd|th)\\b)(?!\\s*(?:{month_names})\\b)/i;"

# This line only appears once (in extractDayNameTime)
if old_lookahead in content:
    content = content.replace(old_lookahead, new_lookahead, 1)
    print("PASS: extractDayNameTime negative lookahead extended with month names")
else:
    print("FAIL: old_lookahead not found")
    # Search for the line
    for i, line in enumerate(content.split('\n'), 1):
        if 'st|nd|rd|th' in line:
            print(f"  Line {i}: {line.strip()[:200]}")

with open('src/lib/extractDateTime.ts', 'w', encoding='utf-8') as f:
    f.write(content)
print("Done")
