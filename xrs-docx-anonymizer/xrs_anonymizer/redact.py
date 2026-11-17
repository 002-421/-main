"""Deterministic Russian rules; ambiguous content is never automatically released."""
from dataclasses import dataclass, field
import re

REMOVED = "[УДАЛЕНО]"
NAME = r"[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?"
PATRONYMIC = r"[А-ЯЁ][а-яё]+(?:ович|евич|ич|овна|евна|ична)"
# These are preserved as clinical vocabulary, not used as a general surname dictionary.
EPONYMS = re.compile(r"\b(?:Шморля|Бехтерева|Альцгеймера|Паркинсона|Крона|Грейвса|Хашимото|Бейкера|Броди|Пертеса|Осгуда|Шлаттера|Шейермана|Мау|Модик|Modic|Pfirrmann|Schmorl|Baker|BI-RADS|PI-RADS|LI-RADS)\b", re.I)
LABEL = re.compile(
    r"(?P<label>(?:Ф\s*\.?\s*И\s*\.?\s*О\s*\.?\s*(?:пациента|врача)?|"
    r"пациент(?:ка)?|врач(?:[-\s]рентгенолог)?|рентгенолог|исследование\s*выполнил[аи]?|"
    r"подпись|дата\s*(?:рождения|исследования)|д[./]р|родился|родилась|"
    r"телефон|тел\.|адрес(?:\s+проживания)?|e-?mail|почта|СНИЛС|ИНН|паспорт|"
    r"полис(?:\s+ОМС)?|(?:ID|идентификатор|код)\s*пациента|"
    r"(?:номер|№)\s*(?:исследования|протокола|карты|истории\s*болезни)|"
    r"медицинское\s*учреждение|учреждение|клиника|больница|организация)\s*[:：=])",
    re.I,
)
BARE_LABEL = re.compile(r"^\s*(?:" + LABEL.pattern + r")\s*$", re.I)
STANDALONE_LABEL = re.compile(
    r"^\s*(?:Ф\.?\s*И\.?\s*О\.?\s*(?:пациента|врача)?|пациент(?:ка)?|врач|"
    r"дата\s*(?:рождения|исследования)|адрес|телефон|СНИЛС|полис|учреждение)\s*[:：]?\s*$", re.I)
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
DATE = re.compile(r"(?<!\d)(?:\d{1,2}[./-]\d{1,2}[./-](?:19|20)?\d{2}|(?:19|20)\d{2}-\d{2}-\d{2})(?!\d)")
SUSPECT_NAME = re.compile(rf"\b{NAME}\s+{NAME}\b")
SUSPECT = [
    ("UNLABELLED_DATE", DATE),
    ("UNLABELLED_IDENTIFIER", re.compile(r"(?<![\d.,])\d{7,}(?![\d.,])")),
    ("POSSIBLE_INITIALS", re.compile(r"\b[А-ЯЁ]\.[ \t]*[А-ЯЁ]\.")),
    ("POSSIBLE_ADDRESS", re.compile(r"\b(?:ул\.|улица|проспект|пр-т|переулок|область|район|г\.)\s*\S+", re.I)),
    ("POSSIBLE_INSTITUTION", re.compile(r"\b(?:ООО|АО|ГБУЗ|ФГБУ|МБУЗ|ГУЗ|ГКБ|ЦРБ|ДКБ|клиник\w*|больниц\w*|медицинск\w*\s+центр\w*)\b", re.I)),
    ("POSSIBLE_LATIN_NAME", re.compile(r"\b[A-Z][a-z]{2,}\s+[A-Z][a-z]{2,}\b")),
]


@dataclass
class Redaction:
    count: int = 0
    categories: set[str] = field(default_factory=set)
    issues: set[str] = field(default_factory=set)


def spans(text: str, result: Redaction) -> list[tuple[int, int]]:
    found: list[tuple[int, int]] = []
    # Labels terminate at a semicolon, tab, newline, or another labelled field.
    labels = list(LABEL.finditer(text))
    for i, match in enumerate(labels):
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


def suspicious(text: str) -> set[str]:
    # A residual label with a value should already have been removed.
    text = LABEL.sub("", text)
    if STANDALONE_LABEL.fullmatch(text):
        return set()
    issues = {name for name, pattern in SUSPECT if pattern.search(text)}
    for match in SUSPECT_NAME.finditer(text):
        if not EPONYMS.search(match.group()):
            issues.add("POSSIBLE_NAME")
    for match in re.finditer(r"\b[А-ЯЁ][а-яё]{2,}(?:ов|ев|ин|ова|ева|ина|ский|ская|цкий|цкая|ович|евич|овна|евна|ична)\b", text):
        if not EPONYMS.search(match.group()):
            issues.add("POSSIBLE_NAME")
    if re.search(r"\b[А-ЯЁ]{2,}(?:ОВ|ЕВ|ИН|ОВА|ЕВА|ИНА|СКИЙ|СКАЯ|ОВИЧ|ЕВИЧ|ОВНА|ЕВНА)\b", text):
        issues.add("POSSIBLE_NAME")
    return issues


def redact_nodes(nodes, result: Redaction) -> None:
    """Match across Word runs while retaining formatting of unaffected characters."""
    originals = [node.text or "" for node in nodes]
    text = "".join(originals)
    changes = spans(text, result)
    if changes:
        offset = 0
        for node, original in zip(nodes, originals):
            end = offset + len(original)
            pieces = []
            cursor = offset
            for start, stop in changes:
                if stop <= offset or start >= end:
                    continue
                pieces.append(text[cursor:max(cursor, start)])
                if offset <= start < end:
                    fragment = text[start:stop].strip()
                    pieces.append("" if fragment.startswith("№") else REMOVED)
                cursor = min(end, stop)
            pieces.append(text[cursor:end])
            node.text = "".join(pieces)
            offset = end
    result.issues.update(suspicious("".join(node.text or "" for node in nodes)))
