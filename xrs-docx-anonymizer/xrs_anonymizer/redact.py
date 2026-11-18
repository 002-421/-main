"""Deterministic Russian rules; ambiguous content is never automatically released."""
from dataclasses import dataclass, field
from datetime import date
import re

REMOVED = "[УДАЛЕНО]"
NAME = r"[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?"
PATRONYMIC = r"[А-ЯЁ][а-яё]+(?:ович|евич|ич|овна|евна|ична)"
# These are preserved as clinical vocabulary, not used as a general surname dictionary.
EPONYMS = re.compile(r"\b(?:Шморля|Бехтерева|Альцгеймера|Паркинсона|Крона|Грейвса|Хашимото|Бейкера|Броди|Пертеса|Осгуда|Шлаттера|Шейермана|Мау|Модик|Modic|Pfirrmann|Schmorl|Baker|BI-RADS|PI-RADS|LI-RADS)\b", re.I)
LABEL = re.compile(
    r"(?P<label>(?:Ф\s*\.?\s*И\s*\.?\s*О\s*\.?\s*(?:пациента|врача)?|"
    r"пациент(?:ка)?|врач(?:[-\s]рентгенолог)?|рентгенолог|исследование\s*выполнил[аи]?|"
    r"подпись|дата\s*(?:рождения|исследования|проведения|выполнения|обследования)?|д[./]р|родился|родилась|"
    r"телефон|тел\.|адрес(?:\s+проживания)?|e-?mail|почта|СНИЛС|ИНН|паспорт|"
    r"полис(?:\s+ОМС)?|(?:ID|идентификатор|код)\s*пациента|"
    r"(?:номер|№)\s*(?:исследования|протокола|карты|истории\s*болезни)|"
    r"медицинское\s*учреждение|учреждение|клиника|больница|организация)\s*[:：=])",
    re.I,
)
BARE_LABEL = re.compile(r"^\s*(?:" + LABEL.pattern + r")\s*$", re.I)
STANDALONE_LABEL = re.compile(
    r"^\s*(?:Ф\.?\s*И\.?\s*О\.?\s*(?:пациента|врача)?|пациент(?:ка)?|врач|"
    r"дата(?:\s*(?:рождения|исследования|проведения|выполнения|обследования))?|адрес|телефон|СНИЛС|полис|учреждение)\s*[:：]?\s*$", re.I)
PATTERNS = [
    ("FULL_NAME", re.compile(rf"\b{NAME}\s+{NAME}\s+{PATRONYMIC}\b")),
    ("INITIALS", re.compile(rf"\b{NAME}\s+[А-ЯЁ]\s*\.\s*[А-ЯЁ]\s*\.(?:\s*[А-ЯЁ]\s*\.)?")),
    ("INITIALS", re.compile(rf"\b[А-ЯЁ]\s*\.\s*[А-ЯЁ]\s*\.\s*{NAME}\b")),
    ("EMAIL", re.compile(r"[\w.+-]+@[\w.-]+\.[A-Za-zА-Яа-я]{2,}", re.I)),
    ("URL", re.compile(r"(?:https?://|www\.)[^\s<>]+", re.I)),
    ("PHONE", re.compile(r"(?<!\w)(?:\+7|8)[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}(?!\d)")),
    ("SNILS", re.compile(r"(?<!\d)\d{3}-\d{3}-\d{3}\s?\d{2}(?!\d)")),
    ("STUDY_ID", re.compile(r"\s*№\s*[A-Za-zА-Яа-я0-9][A-Za-zА-Яа-я0-9_/-]*")),
    ("FULL_NAME", re.compile(r"\b[А-ЯЁ]{2,}(?:-[А-ЯЁ]+)?\s+[А-ЯЁ]{2,}\s+[А-ЯЁ]+(?:ОВИЧ|ЕВИЧ|ОВНА|ЕВНА|ИЧНА)\b")),
    ("INITIALS", re.compile(r"\b[А-ЯЁ]{2,}\s+[А-ЯЁ]\.\s*[А-ЯЁ]\.")),
]
DATE_SPACE = r"[ \t\u00a0\u202f]"
DATE_SUFFIX = r"(?:" + DATE_SPACE + r"+(?:г\.|года))?"
NUMERIC_DATE_CANDIDATE = re.compile(
    r"(?<![\w./-])(?P<day>\d{1,2})(?P<sep>[./-])(?P<month>\d{1,2})(?P=sep)"
    r"(?P<year>\d{2,4})" + DATE_SUFFIX + r"(?![\w/-])"
)
SPACED_NUMERIC_DATE_CANDIDATE = re.compile(
    r"(?<![\w./-])(?P<day>\d{1,2})" + DATE_SPACE + r"*(?P<sep1>[./-])" + DATE_SPACE + r"*(?P<month>\d{1,2})"
    + DATE_SPACE + r"*(?P<sep2>[./-])" + DATE_SPACE + r"*(?P<year>\d{2,4})" + DATE_SUFFIX + r"(?![\w/-])"
)
MIXED_NUMERIC_DATE_CANDIDATE = re.compile(
    r"(?<![\w./-])(?P<day>\d{1,2})(?P<sep1>[./-])(?P<month>\d{1,2})(?P<sep2>[./-])"
    r"(?P<year>\d{2,4})" + DATE_SUFFIX + r"(?![\w/-])"
)
YEAR_FIRST_DATE_CANDIDATE = re.compile(
    r"(?<![\w./-])(?P<year>\d{4})-(?P<month>\d{1,2})-(?P<day>\d{1,2})"
    + DATE_SUFFIX + r"(?![\w/-])"
)
ALTERNATE_YEAR_FIRST_CANDIDATE = re.compile(
    r"(?<![\w./-])(?P<year>\d{4})(?P<sep>[./])(?P<month>\d{1,2})(?P=sep)(?P<day>\d{1,2})"
    + DATE_SUFFIX + r"(?![\w/-])"
)
MONTHS = {
    "января": 1, "февраля": 2, "марта": 3, "апреля": 4, "мая": 5, "июня": 6,
    "июля": 7, "августа": 8, "сентября": 9, "октября": 10, "ноября": 11, "декабря": 12,
    "янв": 1, "фев": 2, "мар": 3, "апр": 4, "май": 5, "июн": 6,
    "июл": 7, "авг": 8, "сен": 9, "сент": 9, "окт": 10, "ноя": 11, "дек": 12,
}
MONTH_PATTERN = "|".join(sorted(MONTHS, key=len, reverse=True))
TEXT_DATE_CANDIDATE = re.compile(
    r"(?<!\w)(?P<day>\d{1,2})" + DATE_SPACE + r"+(?P<month>" + MONTH_PATTERN + r")\.?[, \u00a0]*"
    + DATE_SPACE + r"+"
    r"(?P<year>\d{2,4})" + DATE_SUFFIX + r"(?!\w)", re.I
)
DATE = re.compile(
    r"(?<![\w./-])(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|"
    r"\d{4}-\d{1,2}-\d{1,2}|\d{1,2}" + DATE_SPACE + r"+(?:" + MONTH_PATTERN +
    r")" + DATE_SPACE + r"+\d{2,4})" + DATE_SUFFIX + r"(?![\w/-])", re.I
)
STUDY_TYPE_LABEL = re.compile(r"^[ \t]*область\s+и\s+вид\s+исследования\s*[:：]", re.I | re.M)
SERVICE_DATE_LABEL_ONLY = re.compile(r"^\s*дата(?:\s+(?:исследования|проведения|выполнения|обследования))?\s*[:：]?\s*$", re.I)
DATE_OF_BIRTH_LABEL_ONLY = re.compile(r"^\s*дата\s+рождения\s*[:：]?\s*$", re.I)
SUSPECT_NAME = re.compile(rf"\b{NAME}\s+{NAME}\b")
SAFE_CLINICAL_PHRASE = re.compile(
    r"^(?:головной мозг|спинной мозг|срединные структуры|боковые желудочки|синовиальная жидкость|"
    r"мягкие ткани|позвоночный канал|поясничный отдел|грудной отдел|шейный отдел|"
    r"межпозвонков(?:ый|ые) диск(?:и|а)?|дугоотростчат(?:ый|ые) сустав(?:ы)?|"
    r"коленный сустав|тазобедренный сустав|плечевой сустав|локтевой сустав|"
    r"голеностопный сустав|медиальный мениск|латеральный мениск|суставная щель|"
    r"передняя крестообразная(?: связка)?|задняя крестообразная(?: связка)?|"
    r"крестцово-подвздошн(?:ое сочленение|ые сочленения)|"
    r"мрт позвоночника|кт органов|область и вид исследования)$", re.I
)
SAFE_SCANNER_NAME = re.compile(
    r"^(?:philips\s+(?:achieva|ingenia|intera)|siemens\s+magnetom|"
    r"ge\s+signa|canon\s+aquilion|toshiba\s+vantage|hitachi\s+echelon)$", re.I
)
SAFE_CLINICAL_WORDS = {
    "головной", "мозг", "спинной", "позвоночный", "межпозвонковый", "межпозвонковые",
    "дугоотростчатый", "дугоотростчатые", "поясничный", "грудной", "шейный",
    "мягкий", "суставной", "коленный", "тазобедренный", "плечевой", "локтевой",
    "голеностопный", "медиальный", "латеральный", "крестообразная", "крестцово-подвздошное",
    "крестцово-подвздошные", "межмыщелковое", "подколенная", "паравертебральный",
    "перивентрикулярный", "синовиальный", "ацетабулярный", "вертлужный", "мыщелковый",
    "мозжечковый", "лобный", "теменной", "затылочный", "височный", "гипофизарный",
}
SUSPECT = [
    ("UNLABELLED_IDENTIFIER", re.compile(r"(?<![\d.,])\d{7,}(?![\d.,])")),
    ("POSSIBLE_INITIALS", re.compile(r"\b[А-ЯЁ]\.[ \t]*[А-ЯЁ]\.")),
    ("POSSIBLE_ADDRESS", re.compile(r"\b(?:ул\.|улица|проспект|пр-т|переулок|область|район)\s*\S+", re.I)),
    ("POSSIBLE_ADDRESS", re.compile(r"\bг\.\s+[А-ЯЁ][а-яё-]{2,}\b")),
    ("POSSIBLE_INSTITUTION", re.compile(r"\b(?:ООО|АО|ГБУЗ|ФГБУ|МБУЗ|ГУЗ|ГКБ|ЦРБ|ДКБ|клиник\w*|больниц\w*|медицинск\w*\s+центр\w*)\b", re.I)),
    ("POSSIBLE_LATIN_NAME", re.compile(r"\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b")),
]


@dataclass
class Redaction:
    count: int = 0
    replaced_dates: int = 0
    categories: set[str] = field(default_factory=set)
    issues: set[str] = field(default_factory=set)


@dataclass(frozen=True)
class CalendarDateMatch:
    start: int
    end: int
    valid: bool


def _normalized_year(value: str) -> int | None:
    if len(value) == 2:
        number = int(value)
        return 1900 + number if number >= 50 else 2000 + number
    if len(value) == 4 and value.startswith(("19", "20")):
        return int(value)
    return None


def _valid_date(day: str, month: str | int, year: str) -> bool:
    normalized_year = _normalized_year(year)
    if normalized_year is None:
        return False
    month_number = MONTHS.get(month.casefold().rstrip(".")) if isinstance(month, str) and not month.isdigit() else int(month)
    try:
        date(normalized_year, month_number, int(day))
    except (TypeError, ValueError):
        return False
    return True


def calendar_date_matches(text: str) -> list[CalendarDateMatch]:
    """Return date-shaped values, distinguishing valid dates from ambiguous candidates."""
    found = []
    candidates = (
        (NUMERIC_DATE_CANDIDATE, lambda m: _valid_date(m["day"], m["month"], m["year"])),
        (SPACED_NUMERIC_DATE_CANDIDATE, lambda m: m["sep1"] == m["sep2"] and _valid_date(m["day"], m["month"], m["year"])),
        (MIXED_NUMERIC_DATE_CANDIDATE, lambda m: m["sep1"] == m["sep2"] and _valid_date(m["day"], m["month"], m["year"])),
        (YEAR_FIRST_DATE_CANDIDATE, lambda m: _valid_date(m["day"], m["month"], m["year"])),
        (ALTERNATE_YEAR_FIRST_CANDIDATE, lambda m: False),
        (TEXT_DATE_CANDIDATE, lambda m: _valid_date(m["day"], m["month"], m["year"])),
    )
    for pattern, validator in candidates:
        for match in pattern.finditer(text):
            found.append(CalendarDateMatch(match.start(), match.end(), validator(match)))
    # Keep one longest candidate if formats overlap on the same source text.
    unique = {}
    for item in found:
        key = (item.start, item.end)
        if key not in unique or item.valid:
            unique[key] = item
    return sorted(unique.values(), key=lambda item: (item.start, -(item.end - item.start)))


def spans(text: str, result: Redaction) -> list[tuple[int, int]]:
    found: list[tuple[int, int]] = []
    # Labels terminate at a semicolon, tab, newline, or another labelled field.
    labels = list(LABEL.finditer(text))
    for i, match in enumerate(labels):
        label_text = re.sub(r"\s*[:：=]\s*$", "", match.group("label")).casefold()
        if label_text.startswith("дата") and "рождения" not in label_text:
            # Study/exam dates are neutralized by the calendar-date rule below.
            continue
        start = match.end()
        end = labels[i + 1].start() if i + 1 < len(labels) else len(text)
        delimiter = re.search(r"[;\t\n]", text[start:end])
        if delimiter:
            end = start + delimiter.start()
        while start < end and text[start].isspace():
            start += 1
        while end > start and text[end - 1].isspace():
            end -= 1
        if start < end and text[start:end] != REMOVED:
            found.append((start, end))
            result.categories.add("LABELLED_PERSONAL_DATA")
        elif start == end:
            result.issues.add("EMPTY_PERSONAL_LABEL")
    for category, pattern in PATTERNS:
        for match in pattern.finditer(text):
            # Complete names, initials and contact details are identifying even if
            # a surname coincides with a medical eponym.
            found.append(match.span())
            result.categories.add(category)
    merged: list[tuple[int, int]] = []
    for start, end in sorted(found):
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(end, merged[-1][1]))
        else:
            merged.append((start, end))
    result.count += len(merged)
    return merged


def study_type_lines(text: str) -> list[str]:
    return [line for line in text.splitlines() if STUDY_TYPE_LABEL.match(line)]


def suspicious(text: str) -> set[str]:
    # A residual label with a value should already have been removed.
    text = LABEL.sub("", text)
    if STANDALONE_LABEL.fullmatch(text):
        return set()
    issues = set()
    for name, pattern in SUSPECT:
        candidate = STUDY_TYPE_LABEL.sub("", text) if name == "POSSIBLE_ADDRESS" else text
        if name == "POSSIBLE_LATIN_NAME":
            if any(not SAFE_SCANNER_NAME.fullmatch(match.group()) for match in pattern.finditer(candidate)):
                issues.add(name)
        elif pattern.search(candidate):
            issues.add(name)
    dates = calendar_date_matches(text)
    if any(not match.valid for match in dates):
        issues.add("AMBIGUOUS_DATE_REVIEW")
    for match in SUSPECT_NAME.finditer(text):
        phrase = match.group().casefold()
        if not EPONYMS.search(match.group()) and not SAFE_CLINICAL_PHRASE.fullmatch(phrase):
            issues.add("POSSIBLE_NAME")
    for match in re.finditer(r"\b[А-ЯЁ][а-яё]{2,}(?:ов|ев|ин|ова|ева|ина|ский|ская|цкий|цкая|ович|евич|овна|евна|ична)\b", text):
        if match.group().casefold() not in SAFE_CLINICAL_WORDS and not EPONYMS.search(match.group()):
            issues.add("POSSIBLE_NAME")
    for match in re.finditer(r"\b[А-ЯЁ]{2,}(?:ОВ|ЕВ|ИН|ОВА|ЕВА|ИНА|СКИЙ|СКАЯ|ОВИЧ|ЕВИЧ|ОВНА|ЕВНА)\b", text):
        if match.group().casefold() not in SAFE_CLINICAL_WORDS and not EPONYMS.search(match.group()):
            issues.add("POSSIBLE_NAME")
    return issues


def redact_nodes(nodes, result: Redaction) -> None:
    """Match across Word runs while retaining formatting of unaffected characters."""
    originals = [node.text or "" for node in nodes]
    text = "".join(originals)
    dates = calendar_date_matches(text)
    # Even a date-shaped value that cannot be validated is neutralized; its
    # ambiguity still forces REVIEW_REQUIRED so it can never silently PASS.
    replaceable = [(match.start, match.end, "дата") for match in dates]
    if replaceable:
        apply_ranges(nodes, replaceable)
        result.replaced_dates += len(replaceable)
        result.categories.add("CALENDAR_DATES_REPLACED")
        text = "".join(node.text or "" for node in nodes)
    if any(not match.valid for match in dates):
        result.issues.add("AMBIGUOUS_DATE_REVIEW")
    pii = spans(text, result)
    if pii:
        replacements = []
        for start, end in pii:
            fragment = text[start:end].strip()
            replacements.append((start, end, "" if fragment.startswith("№") else REMOVED))
        apply_ranges(nodes, replacements)
    result.issues.update(suspicious("".join(node.text or "" for node in nodes)))


def apply_ranges(nodes, changes: list[tuple[int, int, str]]) -> None:
    """Apply joined-paragraph ranges across text runs without moving other text."""
    originals = [node.text or "" for node in nodes]
    offset = 0
    for node, original in zip(nodes, originals):
        start_node, end_node = offset, offset + len(original)
        pieces = []
        cursor = start_node
        for start, end, replacement in sorted(changes):
            if end <= start_node or start >= end_node:
                continue
            if start >= cursor:
                pieces.append(original[cursor - start_node:start - start_node])
            if start_node <= start < end_node:
                pieces.append(replacement)
            cursor = max(cursor, min(end_node, end))
        pieces.append(original[cursor - start_node:])
        node.text = "".join(pieces)
        offset = end_node
