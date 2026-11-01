"""Generate the app catalog from the extracted Kochetov Word-template archive.

The checked-in HTML files are conversions of the legacy .dot files. Keeping
them alongside the catalog makes the text/layout import repeatable without
requiring Word at build time. lxml is needed only to regenerate this catalog.
"""
from copy import deepcopy
from pathlib import Path
import json
import re
from lxml import html

ROOT = Path(__file__).resolve().parents[1]
HTML_ROOT = ROOT / 'templates/converted'
OUTPUT = ROOT / 'src/catalog.json'
OLD = json.loads(OUTPUT.read_text(encoding='utf-8'))
AREAS = [
    ('abdomen', 'Брюшная полость и забрюшинное пространство'),
    ('head', 'Голова'),
    ('pelvis', 'Малый таз'),
    ('other', 'Остальные'),
    ('spine', 'Позвоночник'),
    ('joints', 'Суставы'),
]
PATIENT_ID = 'HEAD.BASE.1.FIELD.0001'
DOCTOR_ID = 'HEAD.BASE.2.FIELD.0043'
PAGE = {'sourceFormat': 'alliance-template', 'pageWidthMm': 210, 'pageHeightMm': 297,
        'marginTopMm': 16, 'marginBottomMm': 16, 'marginLeftMm': 18,
        'marginRightMm': 18, 'fontFamily': 'DejaVu Sans',
        'fontSizePt': 10, 'lineHeight': 1.05, 'spaceAfterPt': 5}
NS = 'http://www.w3.org/1999/xhtml'
FIELD_MARK = 'templateField'
YELLOW_MARK = {'type': 'highlight', 'attrs': {'color': '#ffff00'}}


def slug(text):
    translit = str.maketrans({
        'а':'a','б':'b','в':'v','г':'g','д':'d','е':'e','ё':'e','ж':'zh','з':'z','и':'i','й':'i','к':'k','л':'l','м':'m','н':'n','о':'o','п':'p','р':'r','с':'s','т':'t','у':'u','ф':'f','х':'kh','ц':'ts','ч':'ch','ш':'sh','щ':'shch','ъ':'','ы':'y','ь':'','э':'e','ю':'yu','я':'ya',
        'А':'a','Б':'b','В':'v','Г':'g','Д':'d','Е':'e','Ё':'e','Ж':'zh','З':'z','И':'i','Й':'i','К':'k','Л':'l','М':'m','Н':'n','О':'o','П':'p','Р':'r','С':'s','Т':'t','У':'u','Ф':'f','Х':'kh','Ц':'ts','Ч':'ch','Ш':'sh','Щ':'shch','Ъ':'','Ы':'y','Ь':'','Э':'e','Ю':'yu','Я':'ya',
    })
    value = text.translate(translit).lower()
    value = re.sub(r'[^a-z0-9]+', '-', value).strip('-')
    return value or 'template'


def css(style):
    result = {}
    for entry in (style or '').split(';'):
        if ':' in entry:
            key, value = entry.split(':', 1)
            result[key.strip().lower()] = value.strip()
    return result


def mm_to_pt(value):
    match = re.fullmatch(r'([\d.]+)\s*(mm|pt|px)?', str(value).strip(), re.I)
    if not match:
        return None
    number = float(match.group(1)); unit = (match.group(2) or 'pt').lower()
    return number * {'mm': 72 / 25.4, 'pt': 1, 'px': .75}[unit]


def parse_marks(element, inherited=()):
    marks = list(inherited)
    tag = element.tag.lower() if isinstance(element.tag, str) else ''
    if tag in ('b', 'strong'):
        marks.append({'type': 'bold'})
    elif tag in ('i', 'em'):
        marks.append({'type': 'italic'})
    elif tag == 'u':
        marks.append({'type': 'underline'})
    elif tag in ('s', 'strike', 'del'):
        marks.append({'type': 'strike'})
    elif tag in ('sub', 'sup'):
        marks.append({'type': 'subscript' if tag == 'sub' else 'superscript'})
    attrs = {}
    if tag == 'font':
        face = element.get('face')
        if face:
            attrs['fontFamily'] = face
        color = element.get('color')
        if color and color.lower() not in ('black', '#000000'):
            attrs['color'] = color
    style = css(element.get('style'))
    if style.get('font-family'):
        attrs['fontFamily'] = style['font-family'].split(',')[0].strip(" '\"")
    if style.get('font-size'):
        size = mm_to_pt(style['font-size'])
        if size:
            attrs['fontSize'] = f'{size:g}pt'
    if style.get('color') and style['color'].lower() not in ('black', '#000000'):
        attrs['color'] = style['color']
    background = style.get('background-color') or element.get('bgcolor')
    if background and background.lower() not in ('white', '#ffffff', 'transparent'):
        if background.lower() in ('yellow', '#ffff00'):
            marks.append({'type': 'highlight', 'attrs': {'color': '#ffff00'}})
        else:
            attrs['backgroundColor'] = background
    if attrs:
        marks.append({'type': 'textStyle', 'attrs': attrs})
    return marks


def append_run(out, value, marks):
    value = value.replace('\x00', '')
    if not value:
        return
    parts = re.split(r'(\r\n|\r|\n|\t)', value)
    for part in parts:
        if not part:
            continue
        if part in ('\r', '\n', '\r\n'):
            out.append({'type': 'hardBreak'})
        elif part == '\t':
            append_run(out, '    ', marks)
        elif out and out[-1]['type'] == 'text' and out[-1].get('marks', []) == marks:
            out[-1]['text'] += part
        else:
            out.append({'type': 'text', 'text': part, **({'marks': deepcopy(marks)} if marks else {})})


def inline_nodes(element, marks=()):
    out = []
    append_run(out, element.text or '', list(marks))
    for child in element:
        tag = child.tag.lower() if isinstance(child.tag, str) else ''
        if tag == 'br':
            out.append({'type': 'hardBreak'})
        else:
            out.extend(inline_nodes(child, parse_marks(child, marks)))
        append_run(out, child.tail or '', list(marks))
    return out


def style_attrs(paragraph):
    own = css(paragraph.get('style'))
    parent = paragraph.getparent()
    parent_css = css(parent.get('style')) if parent is not None else {}
    attrs = {}
    align = own.get('text-align') or (parent.get('align') if parent is not None else None)
    if align in ('left', 'center', 'right', 'justify'):
        attrs['textAlign'] = align
    indent = mm_to_pt(own.get('text-indent', ''))
    if indent is not None and abs(indent) > .1:
        attrs['firstLineIndentPt'] = round(indent, 3)
    line = mm_to_pt(own.get('line-height', ''))
    if line:
        attrs['lineHeight'] = round(line / PAGE['fontSizePt'], 4)
    margin = parent_css.get('margin', '').split()
    if len(margin) == 4:
        top, right, bottom, left = [mm_to_pt(x) or 0 for x in margin]
        if top: attrs['spaceBeforePt'] = round(top, 3)
        if bottom: attrs['spaceAfterPt'] = round(bottom, 3)
        if left: attrs['leftIndentPt'] = round(left, 3)
        if right: attrs['rightIndentPt'] = round(right, 3)
    return attrs


def make_paragraph(element):
    return {'type': 'paragraph', 'attrs': {'fontFamily': 'DejaVu Sans', 'fontSizePt': 10, **style_attrs(element)}, 'content': inline_nodes(element)}


def plain(node):
    if node.get('type') == 'text': return node.get('text', '')
    return ''.join(plain(child) for child in node.get('content', []))


def split_range(nodes, start, end, mark):
    result, cursor = [], 0
    for node in nodes:
        if node['type'] != 'text':
            result.append(node); continue
        text = node['text']; finish = cursor + len(text)
        cuts = sorted({0, len(text), max(0, min(len(text), start - cursor)), max(0, min(len(text), end - cursor))})
        for a, b in zip(cuts, cuts[1:]):
            if a == b: continue
            clone = {'type': 'text', 'text': text[a:b]}
            marks = deepcopy(node.get('marks', []))
            if start < cursor + b and end > cursor + a:
                marks.append(deepcopy(mark))
            if marks: clone['marks'] = marks
            result.append(clone)
        cursor = finish
    return result


def field_mark(field_id, hint):
    return {'type': FIELD_MARK, 'attrs': {'id': field_id, 'hint': hint, 'original': hint, 'filled': False}}


def transform_paragraph(node, template_id, counter):
    text = plain(node)
    clean = re.sub(r'\s+', ' ', text).strip()
    if re.match(r'^(?:Возраст|Полных лет|Возраст пациента)\s*:', clean, re.I):
        return None
    if re.match(r'^Клинические (?:сведения|данные)(?:\s*/\s*цель)?\s*:', clean, re.I):
        return None
    if re.match(r'^Сравнение(?: с предыдущим исследованием)?\s*:', clean, re.I):
        return None

    def append_field(hint, ident):
        nonlocal node
        inherited = []
        if node['content'] and node['content'][-1]['type'] == 'text':
            inherited = deepcopy(node['content'][-1].get('marks', []))
            node['content'][-1]['text'] += ' '
        node['content'].append({'type': 'text', 'text': hint, 'marks': inherited + [field_mark(ident, hint)]})

    compact = clean.rstrip()
    if re.match(r'^Протокол\s+МРТ[- ]исследования\s+№\s*$', compact, re.I):
        append_field('номер исследования', f'{template_id}.number')
        text = plain(node)
    elif re.match(r'^Ф\.\s*И\.\s*О\.?\s*пациент(?:а|ки)\s*:', compact, re.I):
        append_field('Ф.И.О.', f'{template_id}.patient')
        text = plain(node)
    elif re.match(r'^Дата рождения\s*:', compact, re.I):
        append_field('дд.мм.гггг', f'{template_id}.birthdate')
        text = plain(node)

    # Replace the source author's fixed signature with the user's editable doctor field.
    for match in list(re.finditer(r'Кочетов Сергей Владимирович', text, re.I))[::-1]:
        node['content'] = split_range(node['content'], match.start(), match.end(), field_mark(DOCTOR_ID, 'Ф.И.О. врача'))
    text = plain(node)
    # The legacy Word DATE field was rendered at conversion time; keep it an editable date prompt.
    if re.search(r'Врач\s*:', text, re.I):
        date = re.search(r'(?<!\d)\d{2}\.\d{2}\.\d{4}(?!\d)', text)
        if date:
            node['content'] = split_range(node['content'], date.start(), date.end(), field_mark(f'{template_id}.reportdate', 'дд.мм.гггг'))
            text = plain(node)

    # Make the slash-separated alternatives yellow. These remain ordinary editable text.
    for match in list(re.finditer(r'(?<![\w])(?:[А-Яа-яЁёA-Za-z0-9.-]{2,}\s*/\s*[А-Яа-яЁёA-Za-z0-9.-]{2,})(?![\w])', text, re.U))[::-1]:
        node['content'] = split_range(node['content'], match.start(), match.end(), YELLOW_MARK)
    return node


def cell_node(cell, template_id, counter, table_width_px):
    paragraphs = cell.xpath('.//p[@style]')
    # Ignore paragraphs belonging to nested tables, which are not present in the source set.
    paragraphs = [p for p in paragraphs if not any(a is not cell and a.tag.lower() == 'table' for a in p.iterancestors())]
    content = []
    for p in paragraphs:
        value = transform_paragraph(make_paragraph(p), template_id, counter)
        if value is not None: content.append(value)
    if not content:
        content = [{'type': 'paragraph', 'content': inline_nodes(cell)}]
    attrs = {}
    try:
        width = float((cell.get('width') or '').strip('%'))
        attrs['colwidth'] = [round(table_width_px * width / 100)]
    except ValueError: pass
    for html_attr, node_attr in [('colspan', 'colspan'), ('rowspan', 'rowspan')]:
        try:
            value = int(cell.get(html_attr, '1'))
            if value > 1: attrs[node_attr] = value
        except ValueError: pass
    bg = (cell.get('bgcolor') or '').lower()
    if bg and bg not in ('white', '#ffffff'):
        attrs['backgroundColor'] = bg
    return {'type': 'tableHeader' if cell.tag.lower() == 'th' else 'tableCell', **({'attrs': attrs} if attrs else {}), 'content': content}


def table_node(table, template_id, counter):
    rows = []
    width = 794
    try:
        width *= float((table.get('width') or '100%').strip('%')) / 100
    except ValueError: pass
    for tr in table.xpath('./tr|./thead/tr|./tbody/tr|./tfoot/tr'):
        cells = [cell_node(c, template_id, counter, width) for c in tr.xpath('./td|./th')]
        if not cells: continue
        label = re.sub(r'\s+', ' ', plain({'content': [{'type': 'text', 'text': plain(p)} for c in cells[:1] for p in c['content']]})).strip()
        if re.match(r'^(?:Возраст|Полных лет|Клинические сведения|Клинические данные|Сравнение)\s*:', label, re.I):
            continue
        rows.append({'type': 'tableRow', 'content': cells})
    return {'type': 'table', 'content': rows} if rows else None


def blocks_from_document(path, ident):
    doc = html.parse(str(path))
    body = doc.find('.//body')
    blocks = []
    if body is None: return blocks
    for element in body.iter():
        if element is body or not isinstance(element.tag, str): continue
        tag = element.tag.lower()
        ancestors = [a.tag.lower() for a in element.iterancestors() if isinstance(a.tag, str)]
        if tag == 'table' and 'table' not in ancestors:
            node = table_node(element, ident, {})
            if node: blocks.append(node)
        elif tag == 'p' and element.get('style') and 'table' not in ancestors:
            node = transform_paragraph(make_paragraph(element), ident, {})
            if node is not None: blocks.append(node)
    return blocks


def main():
    templates = []
    areas = []
    for area_id, area_title in AREAS:
        folder = HTML_ROOT / area_title
        areas.append({'id': area_id, 'title': area_title})
        files = sorted(folder.glob('*.html'), key=lambda p: p.name.casefold())
        for path in files:
            title = path.stem
            source_path = path.relative_to(HTML_ROOT).as_posix()
            # An empty duplicate .dot was included beside the usable DOCX version.
            if title == 'ШОП.dot':
                continue
            is_docx = '(DOCX)' in title
            title = title.replace(' (DOCX)', '')
            if is_docx:
                title += ' · DOCX'
            ident = f'{area_id}-{slug(title)}'
            content = blocks_from_document(path, ident)
            if not content:
                continue
            doc = {'type': 'doc', 'attrs': {**PAGE, 'templateId': ident}, 'content': content}
            source_name = source_path.replace(' (DOCX).html', '.dot.docx').replace('.html', '.dot')
            templates.append({'id': ident, 'areaId': area_id, 'title': title,
                              'description': 'Исходный протокол из архива Кочетов С.В.',
                              'sourceFiles': [source_name], 'doc': doc})
    if not templates:
        raise RuntimeError('No source templates were read.')
    default = next(t['id'] for t in templates if t['areaId'] == 'head' and t['title'] == 'ГМ')
    result = {'source': 'Шаблоны МРТ — Кочетов С.В.rar; converted legacy Word templates',
              'defaultTemplateId': default, 'patientFieldId': PATIENT_ID, 'doctorFieldId': DOCTOR_ID,
              'page': deepcopy(PAGE), 'areas': areas, 'templates': templates,
              'blocks': OLD.get('blocks', [])}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, separators=(',', ':')) + '\n', encoding='utf-8')
    print(f'Wrote {len(areas)} zones, {len(templates)} templates and {len(result["blocks"])} add-on blocks to {OUTPUT}')


if __name__ == '__main__':
    main()
