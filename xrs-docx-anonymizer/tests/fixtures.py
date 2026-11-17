"""Synthetic fixtures only: no patient files, no production source paths."""
from base64 import b64decode
from io import BytesIO
from pathlib import Path
import zipfile

from docx import Document
from lxml import etree as ET
from PIL import Image

from xrs_anonymizer.core import CT, REL, W, R, Q, xml


def minimal(text="Очаг 12 × 8 мм. Грыжа Шморля."):
    root = ET.Element(Q("document"), nsmap={"w": W, "r": R})
    body = ET.SubElement(root, Q("body"))
    p = ET.SubElement(body, Q("p"))
    ET.SubElement(ET.SubElement(p, Q("r")), Q("t")).text = text
    types = ET.Element(f"{{{CT}}}Types", nsmap={None: CT})
    ET.SubElement(types, f"{{{CT}}}Default", Extension="rels", ContentType="application/vnd.openxmlformats-package.relationships+xml")
    ET.SubElement(types, f"{{{CT}}}Override", PartName="/word/document.xml", ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml")
    rels = ET.Element(f"{{{REL}}}Relationships", nsmap={None: REL})
    ET.SubElement(rels, f"{{{REL}}}Relationship", Id="rId1", Type=R+"/officeDocument", Target="word/document.xml")
    return {"word/document.xml": xml(root), "[Content_Types].xml": xml(types), "_rels/.rels": xml(rels)}


def write(path: Path, parts):
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in parts.items():
            archive.writestr(name, data)
    return path


def unpack(blob):
    with zipfile.ZipFile(BytesIO(blob)) as archive:
        return {name: archive.read(name) for name in archive.namelist()}


def image(fmt):
    stream = BytesIO()
    Image.new("RGB", (16, 16), (70, 120, 80)).save(stream, format=fmt)
    stream.seek(0)
    return stream


def rich_fixture(path):
    document = Document()
    p = document.add_paragraph()
    p.add_run("Ф.И.О. пациента: Ива").bold = True
    p.add_run("нов Иван ")
    p.add_run("Иванович")
    document.add_paragraph("Врач: Петров Пётр Петрович")
    document.add_paragraph("Дата рождения: 16.10.1973")
    document.add_paragraph("Протокол МРТ №18415")
    document.add_paragraph("На уровне L4-L5 очаг 12 × 8 × 4,5 мм; ADC 0,9 × 10⁻³ мм²/с. Modic II. Грыжа Шморля.")
    p = document.add_paragraph()
    p.add_run("Изменение сигнала ").italic = True
    p.add_run("T2/STIR, справа.")
    table = document.add_table(rows=2, cols=2)
    table.cell(0, 0).text = "Ф.И.О. пациента"
    table.cell(0, 1).text = "Сидоров Сидор Сидорович"
    table.cell(1, 0).text = "Размеры"
    table.cell(1, 1).text = "12 × 8 мм"
    document.add_picture(image("PNG"))
    table.cell(1, 1).paragraphs[0].add_run().add_picture(image("JPEG"))
    header = document.sections[0].header.paragraphs[0]
    header.add_run("Врач: Петров Пётр Петрович")
    header.add_run().add_picture(image("PNG"))
    footer = document.sections[0].footer.paragraphs[0]
    footer.add_run("Заключение без динамики.")
    footer.add_run().add_picture(image("JPEG"))
    document.core_properties.author = "СЕКРЕТ_АВТОР"
    document.core_properties.last_modified_by = "СЕКРЕТ_РЕДАКТОР"
    document.save(path)
    return path
