"""Convert the supplied CT DOCX archive into a sanitized, app-native catalog.

The source archive is kept outside the repository. Only editable template text
and formatting are emitted; document properties and source identifiers are not.
"""
from pathlib import Path
from zipfile import ZipFile
from lxml import etree
import json, re, sys, hashlib

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(sys.argv[1]) if len(sys.argv) > 1 else Path('/tmp/ct-template-source')
OUTPUT = ROOT / 'src/ct-catalog.json'
MRI_CATALOG = json.loads((ROOT / 'src/catalog.json').read_text(encoding='utf-8'))
MRI_HEADER = next(t for t in MRI_CATALOG['templates'] if t['id'] == MRI_CATALOG['defaultTemplateId'])['doc']['content']
PATIENT_ID = MRI_CATALOG['patientFieldId']
DOCTOR_ID = MRI_CATALOG['doctorFieldId']
NS = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
W = '{%s}' % NS['w']
FOLDERS = [
    ('Ангиография', 'angiography'),
    ('Брюшная полость и Забрюшинное пространство', 'abdomen'),
    ('Верхние конечности', 'upper-limbs'),
    ('Голова и Шея', 'head-neck'),
    ('Грудная клетка', 'chest'),
    ('Малый таз', 'pelvis'),
    ('Нижние конечности и Кости таза', 'lower-limbs-pelvis'),
    ('Позвоночник', 'spine'),
]
AREAS = [{'id': 'ct-' + key, 'title': label} for label, key in FOLDERS]

def slug(text):
    value = hashlib.sha1(text.encode('utf-8')).hexdigest()[:10]
    return value

def mark(kind, attrs=None):
    return {'type': kind, **({'attrs': attrs} if attrs else {})}

def parse_runs(p, ident, counter):
    content=[]
    for run in p.xpath('./w:r', namespaces=NS):
        text=''.join(run.xpath('.//w:t/text()',namespaces=NS))
        if run.xpath('.//w:tab',namespaces=NS): text += '\t'
        if not text: continue
        props=run.find(W+'rPr'); marks=[]; text_style={}
        if props is not None:
            if props.find(W+'b') is not None: marks.append(mark('bold'))
            if props.find(W+'i') is not None: marks.append(mark('italic'))
            if props.find(W+'u') is not None: marks.append(mark('underline'))
            hi=props.find(W+'highlight')
            if hi is not None and hi.get(W+'val','').lower() in ('yellow','brightgreen'): marks.append(mark('highlight',{'color':'#ffff00'}))
            fonts=props.find(W+'rFonts')
            if fonts is not None:
                face=fonts.get(W+'ascii') or fonts.get(W+'hAnsi')
                if face: text_style['fontFamily']=face
            size=props.find(W+'sz')
            if size is not None and size.get(W+'val','').isdigit(): text_style['fontSize']=f"{int(size.get(W+'val'))/2:g}pt"
            if text_style: marks.append(mark('textStyle',text_style))
        content.append({'type':'text','text':text,'marks':marks} if marks else {'type':'text','text':text})
    if not content:
        text=''.join(p.xpath('.//w:t/text()',namespaces=NS))
        if text: content=[{'type':'text','text':text}]
    return content

def plain(nodes): return ''.join(x.get('text','') for x in nodes)

def field_node(hint, ident, marks):
    return {'type':'text','text':hint,'marks':[ *marks, mark('templateField',{'id':ident,'hint':hint,'original':hint,'filled':False}) ]}

def convert_paragraph(p, template_id, seq):
    nodes=parse_runs(p,template_id,seq); text=plain(nodes)
    if not text.strip(): return None
    # Strip any author-supplied identity and turn metadata prompts into fields.
    patterns=[
      (r'(Протокол\s+исследования\s*№\s*)(.*)$','number','номер исследования'),
      (r'(Ф\.\s*И\.\s*О\.\s*пациента\s*:\s*)(.*)$','patient','Ф.И.О.'),
      (r'(Дата\s+рождения\s*:\s*)(.*)$','birthdate','дд.мм.гггг'),
      (r'(Врач-рентгенолог\s*:\s*)(.*)$','doctor','Ф.И.О. врача'),
      (r'(Врач\s*:\s*)(.*)$','doctor','Ф.И.О. врача'),
      (r'(Дата\s*:\s*)(.*)$','reportdate','дд.мм.гггг'),
    ]
    for pattern, suffix, hint in patterns:
        m=re.search(pattern,text,re.I)
        if m:
            prefix=text[:m.start(1)]; label=m.group(1)
            inherited=next((n.get('marks',[]) for n in nodes if n.get('text','').strip()),[])
            nodes=[]
            if prefix: nodes.append({'type':'text','text':prefix})
            nodes.append({'type':'text','text':label,'marks':inherited} if inherited else {'type':'text','text':label})
            nodes.append(field_node(hint,f'{template_id}.{suffix}',inherited))
            break
    # Repair the only non-empty physician signature present in the source set.
    text=plain(nodes)
    m=re.search(r'Врач(?:-рентгенолог)?\s*:\s*(.+)$',text,re.I)
    if m and not re.search(r'Ф\.\s*И\.\s*О\.|\[\[',m.group(1),re.I):
        label_end=m.start(1)
        prefix=text[:label_end]
        nodes=[{'type':'text','text':prefix},field_node('Ф.И.О. врача',f'{template_id}.doctor',[]) ]
    paragraph={'type':'paragraph','content':nodes}
    ppr=p.find(W+'pPr')
    if ppr is not None:
        jc=ppr.find(W+'jc')
        if jc is not None:
            align={'center':'center','right':'right','both':'justify','left':'left'}.get(jc.get(W+'val'))
            if align: paragraph['attrs']={'textAlign':align}
    return paragraph

templates=[]
for folder, area_id in FOLDERS:
    directory=SOURCE/folder
    for file in sorted(directory.glob('*.docx'),key=lambda p:p.name.casefold()):
        if file.name.startswith('~$'): continue
        with ZipFile(file) as archive:
            root=etree.fromstring(archive.read('word/document.xml'))
        body=root.find('.//'+W+'body')
        if body is None: continue
        template_id='ct-'+slug(area_id+' '+file.stem)
        content=[]
        for child in body:
            if child.tag!=W+'p': continue
            node=convert_paragraph(child,template_id,len(content))
            if node: content.append(node)
        if not content: continue
        # Replace each archive-specific patient header with the MRI app's
        # standard four-line header, keeping the CT study description.
        area_index=next((i for i,p in enumerate(content) if re.match(r'\s*(?:Область\s+и\s+вид\s+исследования|Вид\s+исследования)\s*:',plain(p['content']),re.I)),None)
        study=plain(content[area_index]['content']) if area_index is not None else f'Вид исследования: Компьютерная томография — {file.stem}'
        study=re.sub(r'^\s*(?:Область\s+и\s+вид\s+исследования|Вид\s+исследования)\s*:\s*','',study,flags=re.I).strip()
        header=[]
        def header_line(text, hint=None, ident=None, style_index=0, bold=False):
            attrs=dict(MRI_HEADER[style_index].get('attrs',{}))
            nodes=[{'type':'text','text':text,'marks':[mark('bold')] if bold else []}]
            if hint: nodes.append(field_node(hint,ident,nodes[0]['marks']))
            header.append({'type':'paragraph','attrs':attrs,'content':nodes})
        header_line('Протокол КТ-исследования № ', 'номер исследования', f'{template_id}.number', 0, True)
        header_line('Ф.И.О. пациента: ', 'Ф.И.О.', f'{template_id}.patient', 1, True)
        header_line('Дата рождения: ', 'дд.мм.гггг', f'{template_id}.birthdate', 2, True)
        header_line('Вид исследования: '+study, style_index=3, bold=True)
        # Drop vendor/device and duplicate identity metadata. Preserve all
        # clinical content beginning after the study-name line.
        body_start=area_index+1 if area_index is not None else 0
        body_content=content[body_start:]
        normalized=[]
        for node in body_content:
            value=plain(node['content'])
            if re.match(r'\s*(?:Ф\.\s*И\.\s*О\.?\s*пациента|Дата\s+рождения|Протокол\s+исследования\s*№)\s*:',value,re.I): continue
            if re.match(r'\s*Врач(?:-рентгенолог)?\s*:',value,re.I):
                normalized.append({'type':'paragraph','attrs':dict(MRI_HEADER[1].get('attrs',{})), 'content':[
                    {'type':'text','text':'Врач-рентгенолог: ','marks':[mark('bold')]},
                    field_node('Ф.И.О. врача',DOCTOR_ID,[mark('bold')]) ]})
                continue
            # Match MRI's first-line paragraph indent throughout the report
            # body, while keeping the study metadata and printed date flush-left.
            metadata = r'\s*(?:Фамилия\s*,\s*имя\s*,\s*отчество|Исследование\s*:|Контрастный\s+препарат\s*:|Доза\s*:|Протокол\s+исследования\s*№|Мультиспиральная\s+компьютерная\s+томография|Toshiba\b)'
            if node.get('type') == 'paragraph' and not re.match(metadata, value, re.I) and not re.match(r'\s*Дата\s*:',value,re.I):
                node.setdefault('attrs',{})['firstLineIndentPt']=17.717
            normalized.append(node)
        if not any('Врач-рентгенолог:' in plain(p['content']) for p in normalized):
            normalized.append({'type':'paragraph','attrs':dict(MRI_HEADER[1].get('attrs',{})), 'content':[
                {'type':'text','text':'Врач-рентгенолог: ','marks':[mark('bold')]},
                field_node('Ф.И.О. врача',DOCTOR_ID,[mark('bold')]) ]})
        content=header+normalized
        templates.append({'id':template_id,'areaId':'ct-'+area_id,'title':file.stem.strip(),
                          'description':'Исходный протокол КТ','sourceFiles':[file.name],
                          'modality':'ct','doc':{'type':'doc','content':content}})

OUTPUT.write_text(json.dumps({'areas':AREAS,'templates':templates},ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Wrote {len(templates)} CT templates in {len(AREAS)} folders to {OUTPUT}')
