"""Read our previously delivered Word templates into the app's rich catalog.

The source DOCX files, including content controls and their exact text, live in
../mri-templates. This script deliberately does not import the original clinical
.dot reports. Only the two retired header entries (age/clinical goal) are removed.
Run from any cwd: python3 scripts/generate_catalog.py
"""
from copy import deepcopy
from pathlib import Path
from zipfile import ZipFile
import json
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
SOURCES = ROOT.parent / 'mri-templates'
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
NS = {'w': W[1:-1]}


def val(node, name, default=None):
    child = node.find('w:' + name, NS) if node is not None else None
    return child.get(W + 'val', default) if child is not None else default


def props(node, theme_fonts=None):
    result = {}
    if node is None:
        return result
    for key, tag in [('bold', 'b'), ('italic', 'i')]:
        item = node.find('w:' + tag, NS)
        if item is not None:
            result[key] = item.get(W + 'val', '1') not in ['0', 'false']
    fonts = node.find('w:rFonts', NS)
    if fonts is not None:
        # In OOXML an explicit theme reference takes precedence over the
        # literal ascii/hAnsi name. Our source heading styles retain
        # majorHAnsi even though their literal name was set to DejaVu Sans.
        theme = fonts.get(W + 'hAnsiTheme') or fonts.get(W + 'asciiTheme')
        themed = (theme_fonts or {}).get(theme)
        result['fontFamily'] = themed or fonts.get(W + 'hAnsi') or fonts.get(W + 'ascii', 'DejaVu Sans')
    size = val(node, 'sz')
    if size is not None:
        result['fontSizePt'] = float(size) / 2
    color = val(node, 'color')
    if color and color != 'auto':
        result['color'] = '#' + color
    align = val(node, 'jc')
    if align:
        result['textAlign'] = {'both': 'justify'}.get(align, align)
    spacing = node.find('w:spacing', NS)
    if spacing is not None:
        for name in ['before', 'after']:
            if spacing.get(W + name) is not None:
                result['space' + name.title() + 'Pt'] = float(spacing.get(W + name)) / 20
        if spacing.get(W + 'line') is not None and spacing.get(W + 'lineRule', 'auto') == 'auto':
            result['lineHeight'] = float(spacing.get(W + 'line')) / 240
    keep = node.find('w:keepNext', NS)
    if keep is not None:
        result['keepNext'] = keep.get(W + 'val', '1') not in ['0', 'false']
    return result


class Reader:
    def __init__(self, filename):
        with ZipFile(filename) as package:
            self.root = ET.fromstring(package.read('word/document.xml'))
            styles = ET.fromstring(package.read('word/styles.xml'))
            theme = ET.fromstring(package.read('word/theme/theme1.xml'))
        drawing_ns = {'a': 'http://schemas.openxmlformats.org/drawingml/2006/main'}
        self.theme_fonts = {}
        for family in ['major', 'minor']:
            latin = theme.find(f'.//a:fontScheme/a:{family}Font/a:latin', drawing_ns)
            if latin is not None:
                self.theme_fonts[family + 'HAnsi'] = latin.get('typeface')
        self.styles = {s.get(W + 'styleId'): s for s in styles.findall('w:style', NS)}
        self.pending_break = False

    def style(self, name):
        node = self.styles.get(name)
        if node is None:
            return {}
        base = val(node, 'basedOn')
        result = self.style(base) if base and base != name else {}
        result.update(props(node.find('w:pPr', NS), self.theme_fonts))
        result.update(props(node.find('w:rPr', NS), self.theme_fonts))
        return result

    def marks(self, fmt):
        attrs = {'fontFamily': fmt.get('fontFamily', 'DejaVu Sans'),
                 'fontSize': f"{fmt.get('fontSizePt', 10) * 4 / 3:.5f}".rstrip('0').rstrip('.') + 'px'}
        if fmt.get('color'):
            attrs['color'] = fmt['color']
        marks = [{'type': 'textStyle', 'attrs': attrs}]
        if fmt.get('bold'):
            marks.append({'type': 'bold'})
        if fmt.get('italic'):
            marks.append({'type': 'italic'})
        return marks

    def inline(self, paragraph, fmt):
        content = []
        for element in paragraph:
            if element.tag == W + 'r':
                runfmt = {**fmt, **props(element.find('w:rPr', NS), self.theme_fonts)}
                for child in element:
                    if child.tag == W + 't' and child.text:
                        content.append({'type': 'text', 'text': child.text, 'marks': self.marks(runfmt)})
                    if child.tag == W + 'tab':
                        content.append({'type': 'text', 'text': '\t', 'marks': self.marks(runfmt)})
                    if child.tag == W + 'br':
                        if child.get(W + 'type') == 'page':
                            self.pending_break = True
                        else:
                            content.append({'type': 'hardBreak'})
            elif element.tag == W + 'sdt':
                text = ''.join(t.text or '' for t in element.findall('.//w:t', NS))
                hint = text.removeprefix('⟦').removesuffix('⟧')
                ident = val(element.find('w:sdtPr', NS), 'tag')
                content.append({'type': 'reportField', 'attrs': {'id': ident, 'hint': hint, 'value': ''}, 'marks': self.marks(fmt)})
        return content

    def paragraph(self, element):
        ppr = element.find('w:pPr', NS)
        source_style = val(ppr, 'pStyle', 'Normal')
        fmt = {'fontFamily': 'DejaVu Sans', 'fontSizePt': 10, 'lineHeight': 1.05,
               'spaceBeforePt': 0, 'spaceAfterPt': 5, **self.style(source_style), **props(ppr, self.theme_fonts)}
        attrs = {key: fmt[key] for key in ['fontFamily', 'fontSizePt', 'lineHeight', 'spaceBeforePt', 'spaceAfterPt', 'textAlign', 'keepNext'] if key in fmt}
        attrs['sourceStyle'] = source_style
        # A dedicated Word page-break paragraph is represented on the next real
        # paragraph, preserving the page boundary without an extra blank line.
        previous_break = self.pending_break
        self.pending_break = False
        content = self.inline(element, fmt)
        if self.pending_break and not content:
            return None
        if previous_break:
            attrs['pageBreakBefore'] = True
        if source_style in ['Heading1', 'Heading2', 'Heading3']:
            attrs['level'] = int(source_style[-1])
            kind = 'heading'
        else:
            kind = 'paragraph'
        return {'type': kind, 'attrs': attrs, 'content': content}

    def table(self, element):
        widths = [float(n.get(W + 'w', '0')) / 15 for n in element.findall('w:tblGrid/w:gridCol', NS)]
        rows = []
        for row in element.findall('w:tr', NS):
            is_header = row.find('w:trPr/w:tblHeader', NS) is not None
            cells = []
            for i, cell in enumerate(row.findall('w:tc', NS)):
                attrs = {'colspan': 1, 'rowspan': 1, 'colwidth': [round(widths[i], 5)]}
                shade = cell.find('w:tcPr/w:shd', NS)
                if shade is not None and shade.get(W + 'fill'):
                    attrs['backgroundColor'] = '#' + shade.get(W + 'fill')
                children = [self.paragraph(p) for p in cell.findall('w:p', NS)]
                cells.append({'type': 'tableHeader' if is_header else 'tableCell', 'attrs': attrs,
                              'content': [p for p in children if p is not None]})
            rows.append({'type': 'tableRow', 'content': cells})
        return {'type': 'table', 'content': rows}

    def read(self):
        nodes = []
        for element in self.root.find('w:body', NS):
            if element.tag == W + 'p':
                node = self.paragraph(element)
                if node is not None:
                    nodes.append(node)
            elif element.tag == W + 'tbl':
                nodes.append(self.table(element))
        return nodes


def text(node):
    return node.get('text', '') + ''.join(text(n) for n in node.get('content', []))


def section(ident, title, content, module=''):
    return {'type': 'reportSection', 'attrs': {'id': ident, 'title': title, 'moduleId': module}, 'content': content}


PAGE = {'sourceFormat': 'alliance-template', 'pageWidthMm': 210, 'pageHeightMm': 297,
        'marginTopMm': 16, 'marginBottomMm': 16, 'marginLeftMm': 18, 'marginRightMm': 18,
        'fontFamily': 'DejaVu Sans', 'fontSizePt': 10, 'lineHeight': 1.05, 'spaceAfterPt': 5,
        'footerText': 'МРТ головы • v1.0   |   '}


def document(nodes):
    return {'type': 'doc', 'attrs': deepcopy(PAGE), 'content': deepcopy(nodes)}


def base_sections():
    nodes = Reader(SOURCES / 'MRI_Head_Base.docx').read()
    # Prior explicit user instruction removes these entries while all other
    # generated template wording, formatting, and field identities are retained.
    table = next(n for n in nodes if n['type'] == 'table')
    table['content'] = [row for row in table['content'] if text(row['content'][0]) != 'Клинические сведения / цель']
    row = next(row for row in table['content'] if text(row['content'][0]) == 'Дата рождения / возраст')
    row['content'][0]['content'][0]['content'][0]['text'] = 'Дата рождения'
    cell = row['content'][1]['content'][0]
    cell['content'] = [n for n in cell['content'] if n['type'] == 'reportField' and n['attrs']['hint'] == 'дд.мм.гггг']
    titles = {'МЕТОДИКА': ('method', 'Методика'),
              'ОПИСАНИЕ • ГОЛОВНОЙ МОЗГ': ('brain', 'Головной мозг'),
              'ЖЕЛУДОЧКОВАЯ СИСТЕМА': ('ventricles', 'Желудочковая система'),
              'ЛИКВОРНЫЕ ПРОСТРАНСТВА И ПРИЛЕЖАЩИЕ СТРУКТУРЫ': ('adjacent', 'Ликворные пространства и прилежащие структуры'),
              'ДОПОЛНИТЕЛЬНЫЕ БЛОКИ • ПРИ НАЛИЧИИ': ('additional', 'Дополнительные блоки'),
              'ЗАКЛЮЧЕНИЕ': ('conclusion', 'Заключение'),
              'РЕКОМЕНДАЦИИ И ПОДПИСЬ': ('signature', 'Рекомендации и подпись')}
    result = [section('header', 'Данные исследования', [])]
    pending_page = []
    for node in nodes:
        label = text(node)
        if node.get('attrs', {}).get('pageBreakBefore'):
            pending_page.append(node)
            continue
        if pending_page and node.get('attrs', {}).get('sourceStyle') == 'Subtitle':
            pending_page.append(node)
            continue
        if node['type'] == 'heading' and label in titles:
            ident, title = titles[label]
            result.append(section(ident, title, pending_page + [node]))
            pending_page = []
        else:
            result[-1]['content'].append(node)
    return result


def source_modules():
    nodes = Reader(SOURCES / 'MRI_Head_Modules.docx').read()
    modules = {}
    current = None
    skip_use = False
    for node in nodes:
        label = text(node)
        match = re.match(r'^([MF]\d+)  •  (.+)$', label)
        if node['type'] == 'heading' and node.get('attrs', {}).get('level') == 1 and match:
            current = match[1]
            node['attrs'].pop('pageBreakBefore', None)
            modules[current] = {'title': match[2], 'content': [node], 'conclusion': []}
            skip_use = True
            continue
        if not current:
            continue
        if skip_use:
            modules[current]['description'] = label
            skip_use = False
            continue
        if label.startswith('Основа блока:'):
            current = None
            continue
        if label == 'В ОБЩЕЕ ЗАКЛЮЧЕНИЕ' and node['type'] == 'heading':
            modules[current]['in_conclusion'] = True
            continue
        if modules[current].get('in_conclusion'):
            modules[current]['conclusion'].append(node)
        else:
            modules[current]['content'].append(node)
    return modules


def main():
    base = base_sections()
    modules = source_modules()
    plans = [
        ('brain', 'brain', 'Базовый протокол', 'МРТ головного мозга', [], True),
        ('brain-contrast', 'brain', 'С контрастным усилением', 'Базовый протокол + контрастное усиление', ['M01'], True),
        ('brain-arteries', 'brain', 'Головной мозг + МРА', 'Базовый протокол + МР-ангиография', ['M02'], True),
        ('brain-vessels', 'brain', 'Головной мозг + МРА + МРВ', 'Базовый протокол + артерии и венозные синусы', ['M02', 'M03'], True),
        ('brain-demyelination', 'brain', 'Демиелинизирующие изменения', 'Базовый протокол + специализированный блок', ['M05'], True),
        ('brain-cognitive', 'brain', 'Когнитивные нарушения', 'Базовый протокол + оценка атрофических изменений', ['M06'], True),
        ('brain-parkinson', 'brain', 'Паркинсонизм', 'Базовый протокол + структуры среднего мозга', ['M07'], True),
        ('brain-epilepsy', 'brain', 'Эпилептологический протокол', 'Базовый протокол + эпилептологический блок', ['M08'], True),
        ('brain-nvc', 'brain', 'Нейроваскулярные взаимоотношения', 'Базовый протокол + нейроваскулярные взаимоотношения', ['M09'], True),
        ('brain-iac', 'brain', 'Внутренние слуховые проходы', 'Базовый протокол + прицельный блок ВСП', ['M10'], True),
        ('arteries', 'vessels', 'МР-ангиография артерий', 'Самостоятельная МРА', ['M02'], False),
        ('veins', 'vessels', 'МР-венография', 'Самостоятельная МРВ', ['M03'], False),
        ('pituitary', 'pituitary', 'Гипофиз с контрастированием', 'Прицельный протокол гипофиза + контрастное усиление', ['M04', 'M01'], False),
        ('orbits', 'orbits', 'Орбиты и зрительные нервы', 'Самостоятельное исследование орбит', ['M11'], False),
        ('sinuses', 'sinuses', 'Околоносовые пазухи', 'Самостоятельное исследование пазух', ['M12'], False),
        ('custom', 'custom', 'Универсальный протокол', 'Общие данные, заключение и подпись для другой области', [], False),
    ]
    templates = []
    for ident, area, title, description, selected, include_brain in plans:
        if include_brain:
            content = deepcopy(base)
        else:
            content = [deepcopy(s) for s in base if s['attrs']['id'] in ['header', 'conclusion', 'signature']]
        if selected:
            content = [s for s in content if s['attrs']['id'] != 'additional']
            conclusion = next(s for s in content if s['attrs']['id'] == 'conclusion')
            index = content.index(conclusion)
            for module_id in selected:
                module = modules[module_id]
                content.insert(index, section(module_id, module['title'], deepcopy(module['content']), module_id))
                index += 1
                # The source guide explicitly merges module conclusions into
                # one final conclusion, keeping each original placeholder.
                conclusion['content'].extend(deepcopy(module['conclusion']))
        templates.append({'id': ident, 'areaId': area, 'title': title, 'description': description,
                          'sourceFiles': ['MRI_Head_Base.docx'] + (['MRI_Head_Modules.docx'] if selected else []),
                          'doc': document(content)})
    blocks = [{'id': ident, 'title': module['title'], 'description': module.get('description', ''),
               'doc': document([section(ident, module['title'], module['content'], ident)]),
               'conclusion': module['conclusion']} for ident, module in modules.items()]
    result = {'source': 'Previously delivered MRI_Head_Base.docx and MRI_Head_Modules.docx',
              'page': PAGE, 'templates': templates, 'blocks': blocks}
    target = ROOT / 'src/catalog.json'
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(f'Wrote {len(templates)} templates and {len(blocks)} source-format blocks: {target}')


if __name__ == '__main__':
    main()
