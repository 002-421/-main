"""OOXML allowlist reconstruction. Input package parts are never copied verbatim."""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from io import BytesIO
from pathlib import Path, PurePosixPath
import os
import re
import stat
import zipfile

from lxml import etree as ET

from .redact import Redaction, REMOVED, SERVICE_DATE_LABEL_ONLY, STANDALONE_LABEL, STUDY_TYPE_LABEL, redact_nodes, service_date_spans, spans, study_type_lines, suspicious

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
REL = "http://schemas.openxmlformats.org/package/2006/relationships"
CT = "http://schemas.openxmlformats.org/package/2006/content-types"
XML = "http://www.w3.org/XML/1998/namespace"
MC = "http://schemas.openxmlformats.org/markup-compatibility/2006"
NS = {"w": W, "r": R}
Q = lambda tag: f"{{{W}}}{tag}"

MAX_INPUT = 128 * 1024 * 1024
MAX_PART = 16 * 1024 * 1024
MAX_TOTAL = 64 * 1024 * 1024
MAX_ENTRIES = 2048
MAX_RATIO = 250
MAX_NODES = 250_000


class Blocked(Exception):
    """Only fixed, non-identifying reason codes may cross the engine boundary."""


@dataclass
class Result:
    case_id: str
    status: str = "BLOCKED"
    removed_fields: int = 0
    removed_images: int = 0
    categories: list[str] = field(default_factory=list)
    reason: str = ""

    def record(self):
        return asdict(self)


def parse(data: bytes):
    if b"<!DOCTYPE" in data.upper() or b"<!ENTITY" in data.upper():
        raise Blocked("XML_DTD_FORBIDDEN")
    try:
        root = ET.fromstring(data, ET.XMLParser(resolve_entities=False, no_network=True,
                            load_dtd=False, huge_tree=False, recover=False))
    except (ET.XMLSyntaxError, ValueError):
        raise Blocked("INVALID_XML") from None
    if root.getroottree().docinfo.doctype:
        raise Blocked("XML_DTD_FORBIDDEN")
    if sum(1 for _ in root.iter()) > MAX_NODES:
        raise Blocked("XML_NODE_LIMIT")
    return root


def xml(root) -> bytes:
    return ET.tostring(root, encoding="UTF-8", xml_declaration=True, standalone=True)


def read_package(path: Path) -> dict[str, bytes]:
    if path.stat().st_size > MAX_INPUT:
        raise Blocked("INPUT_SIZE_LIMIT")
    with zipfile.ZipFile(path) as archive:
        infos = archive.infolist()
        if len(infos) > MAX_ENTRIES:
            raise Blocked("ZIP_ENTRY_LIMIT")
        seen = set()
        total = 0
        for info in infos:
            name = info.filename
            if (name in seen or "\\" in name or name.startswith("/") or
                    any(p in ("..", ".") for p in name.split("/")) or
                    ":" in name or "\x00" in name or
                    stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1):
                raise Blocked("UNSAFE_ZIP_ENTRY")
            seen.add(name)
            total += info.file_size
            if (info.file_size > MAX_PART or total > MAX_TOTAL or
                    info.file_size > max(1, info.compress_size) * MAX_RATIO):
                raise Blocked("ZIP_EXPANSION_LIMIT")
        data = {}
        for info in infos:
            if info.is_dir():
                continue
            with archive.open(info) as stream:
                body = stream.read(MAX_PART + 1)
                if len(body) > MAX_PART or len(body) != info.file_size:
                    raise Blocked("ZIP_SIZE_MISMATCH")
                data[info.filename] = body
    for required in ("[Content_Types].xml", "_rels/.rels", "word/document.xml"):
        if required not in data:
            raise Blocked("MISSING_OOXML_PART")
    return data


# Only these package components are understood. Unexpected components fail closed.
STORY = re.compile(r"word/(?:document|header\d+|footer\d+|footnotes|endnotes)\.xml\Z")
DISCARD = re.compile(r"(?:docProps/[^/]+|customXml/.+|word/(?:media|embeddings|activeX|printerSettings|theme|fonts|charts|diagrams|ink|webextensions)/.+|word/(?:comments[^/]*|people|settings|webSettings|fontTable|stylesWithEffects|vbaProject|vbaData|glossary/document)\.(?:xml|bin)|_xmlsignatures/.+)\Z")

# Attribute values cannot contain arbitrary original identifiers in the rebuilt file.
NUMERIC = {"w", "h", "top", "bottom", "left", "right", "header", "footer", "gutter",
           "before", "after", "line", "start", "end", "firstLine", "hanging", "pos",
           "sz", "space", "gridSpan", "ilvl", "numId", "abstractNumId", "lvlRestart", "linePitch", "charSpace"}
SAFE_ENUM = re.compile(r"[A-Za-z][A-Za-z0-9-]{0,39}\Z")
ENUMS = {
    "val": set("true false on off auto single double dotted dash dotDash dotDotDash wave thick none nil left right center both distribute start end top bottom baseline superscript subscript clear decimal upperRoman lowerRoman upperLetter lowerLetter bullet ordinal cardinalText ordinalText noBreak word all smallCaps continuous nextPage evenPage oddPage portrait landscape fixed autofit restart eachSect eachPage never nextColumn firstLine hanging leftToRight rightToLeft tbRl btLr lrTb tbRlV tbLrV lrTbV left right both balance hyphen space tab nothing singleLevel multilevel hybridMultilevel default".split()),
    "type": set("paragraph character table numbering auto dxa pct clear page column textWrapping continuous nextPage evenPage oddPage default first even separator continuationSeparator".split()),
    "orient": {"portrait", "landscape"},
    "lineRule": {"auto", "exact", "atLeast"},
    "rule": {"auto", "exact", "atLeast"},
}
PROPS = set("pPr rPr tblPr trPr tcPr tblGrid gridCol pStyle rStyle basedOn next link style name docDefaults pPrDefault rPrDefault styles b bCs i iCs u strike dstrike caps smallCaps sz szCs color highlight vertAlign position spacing ind jc keepNext keepLines pageBreakBefore widowControl outlineLvl contextualSpacing tabs tab tblW tblInd tblLayout tblBorders top left bottom right insideH insideV start end tcBorders shd tcW gridSpan vMerge hMerge trHeight cantSplit tblHeader vAlign textDirection cellMargin top bottom left right tblCellMar tcMar pgSz pgMar cols col titlePg pgNumType numPr ilvl numId numbering num abstractNum abstractNumId multiLevelType lvl start numFmt lvlText lvlJc lvlRestart suff sectPr footnotePr endnotePr".split())
PROPS.update("docGrid snapToGrid rtl bidi tblLook suppressAutoHyphens mirrorIndents adjustRightInd suppressOverlap noWrap fitText noProof kern szCs tblCaption tblDescription".split())
PROPS.update("pBdr tblStyleColBandSize tblStylePr tblStyleRowBandSize".split())
ENUMS["val"].update("black blue cyan green magenta red yellow white darkBlue darkCyan darkGreen darkMagenta darkRed darkYellow darkGray lightGray".split())
ENUMS["type"].update("wholeTable firstRow lastRow firstCol lastCol band1Vert band2Vert band1Horz band2Horz neCell nwCell seCell swCell".split())
CONTENT = set("document body p r t tbl tr tc sdtContent footnotes footnote endnotes endnote hdr ftr br cr tab noBreakHyphen softHyphen footnoteReference endnoteReference separator continuationSeparator".split())
WRAPPERS = set("sdt sdtContent smartTag customXml ins moveTo hyperlink fldSimple dir bdo".split())
DROP = set("del moveFrom instrText delText delInstrText commentRangeStart commentRangeEnd commentReference bookmarkStart bookmarkEnd permStart permEnd proofErr lastRenderedPageBreak fldChar annotationRef sdtPr sdtEndPr customXmlPr smartTagPr pPrChange rPrChange tblPrChange tcPrChange trPrChange sectPrChange cellIns cellDel cellMerge moveFromRangeStart moveFromRangeEnd moveToRangeStart moveToRangeEnd".split())
DROP.update("latentStyles lsdException uiPriority semiHidden unhideWhenUsed qFormat rsid personal personalCompose personalReply autoRedefine hidden locked linkStyles lang rFonts numStyleLink styleLink nsid tmpl numPicBullet lvlPicBulletId tblCaption tblDescription".split())
GRAPHICS = {"drawing", "pict", "object", "background", "control", "altChunk", "subDoc"}


class Rebuilder:
    def __init__(self, package: dict[str, bytes]):
        self.package = package
        self.redaction = Redaction()
        self.images = 0
        self.styles: dict[str, str] = {}
        self.style_hidden: dict[str, bool] = {}
        self.default_hidden = False
        self.notes = {"footnote": {}, "endnote": {}}
        self.number_ids = {}
        self.abstract_ids = {}
        self.header_refs: dict[str, str] = {}
        self.parts: dict[str, bytes] = {}
        self.story_roots = {}
        self.has_numbering = False
        self.study_type_texts: list[str] = []
        self.study_type_rows: list[tuple[str, ...]] = []

    def inspect(self):
        for name, data in self.package.items():
            if name == "[Content_Types].xml":
                parse(data)
            elif name.endswith(".rels"):
                root = parse(data)
                if root.tag != f"{{{REL}}}Relationships":
                    raise Blocked("INVALID_RELATIONSHIPS")
                for relation in root:
                    if relation.get("TargetMode") == "External":
                        self.redaction.categories.add("EXTERNAL_LINKS_REMOVED")
                    if relation.get("Type", "").endswith("/image"):
                        self.images += 1
            elif STORY.fullmatch(name):
                self.story_roots[name] = parse(data)
            elif name in {"word/styles.xml", "word/numbering.xml"}:
                parse(data)
            elif DISCARD.fullmatch(name):
                self.redaction.categories.add("PACKAGE_COMPONENTS_REMOVED")
            else:
                raise Blocked("UNSUPPORTED_PACKAGE_COMPONENT")
        # Count media resources, including orphaned ones. This is not the number of placements.
        self.images = max(self.images, sum(n.startswith("word/media/") for n in self.package))
        self.redaction.categories.add("METADATA_REBUILT")
        expected = {"document": "document", "footnotes": "footnotes", "endnotes": "endnotes"}
        for name, root in self.story_roots.items():
            stem = PurePosixPath(name).stem
            kind = expected.get(stem, "hdr" if stem.startswith("header") else "ftr")
            if root.tag != Q(kind):
                raise Blocked("INVALID_STORY_ROOT")
        if self.story_roots["word/document.xml"].find(Q("body")) is None:
            raise Blocked("MISSING_DOCUMENT_BODY")
        self.prepare_maps()

    def prepare_maps(self):
        if "word/styles.xml" in self.package:
            root = parse(self.package["word/styles.xml"])
            styles = root.findall(Q("style"))
            defaults = root.find("w:docDefaults/w:rPrDefault/w:rPr", NS)
            self.default_hidden = bool(self.hidden_property(defaults))
            style_nodes = {}
            for node in styles:
                key = node.get(Q("styleId"))
                if key is not None:
                    self.styles[key] = f"S{len(self.styles) + 1}"
                    style_nodes[key] = node
            def resolve(key, visited):
                if key in self.style_hidden:
                    return self.style_hidden[key]
                if key in visited:
                    raise Blocked("STYLE_INHERITANCE_CYCLE")
                node = style_nodes.get(key)
                if node is None:
                    return self.default_hidden
                explicit = self.hidden_property(node.find(Q("rPr")))
                parent = node.find(Q("basedOn"))
                value = explicit if explicit is not None else resolve(parent.get(Q("val")), visited | {key}) if parent is not None else self.default_hidden
                self.style_hidden[key] = value
                return value
            for key in style_nodes:
                resolve(key, set())
        for kind in self.notes:
            root = self.story_roots.get(f"word/{kind}s.xml")
            if root is not None:
                for note in root.findall(Q(kind)):
                    old = note.get(Q("id"), "")
                    if not re.fullmatch(r"-?\d{1,9}", old):
                        raise Blocked("INVALID_NOTE_ID")
                    self.notes[kind][old] = old if int(old) <= 0 else str(len(self.notes[kind]) + 1)
        if "word/numbering.xml" in self.package:
            root = parse(self.package["word/numbering.xml"])
            for tag, target, attr in [("num", self.number_ids, "numId"), ("abstractNum", self.abstract_ids, "abstractNumId")]:
                for node in root.findall(Q(tag)):
                    value = node.get(Q(attr))
                    if value is not None:
                        target[value] = str(len(target) + 1)
            self.has_numbering = True

    @staticmethod
    def hidden_property(props):
        if props is None:
            return None
        found = [props.find(Q(tag)) for tag in ("vanish", "webHidden")]
        values = [n.get(Q("val"), "true") not in {"0", "false", "off"} for n in found if n is not None]
        return any(values) if values else None

    def hidden_run(self, node):
        props = node.find(Q("rPr"))
        explicit = self.hidden_property(props)
        if explicit is not None:
            return explicit
        style = props.find(Q("rStyle")) if props is not None else None
        if style is not None:
            return self.style_hidden.get(style.get(Q("val")), self.default_hidden)
        paragraph = next((n for n in node.iterancestors(Q("p"))), None)
        if paragraph is not None:
            style = paragraph.find("w:pPr/w:pStyle", NS)
            if style is not None:
                return self.style_hidden.get(style.get(Q("val")), self.default_hidden)
        return self.default_hidden

    def attrs(self, src, dst, local):
        for key, value in src.attrib.items():
            if not key.startswith("{" + W + "}"):
                continue
            attr = ET.QName(key).localname
            if local == "style" and attr == "styleId":
                dst.set(key, self.styles.get(value, "S0"))
            elif local in {"pStyle", "rStyle", "basedOn", "next", "link"} and attr == "val":
                if value in self.styles:
                    dst.set(key, self.styles[value])
            elif local == "name":
                dst.set(Q("val"), "Style")
            elif local in {"footnote", "endnote", "footnoteReference", "endnoteReference"} and attr == "id":
                kind = "footnote" if local.startswith("footnote") else "endnote"
                if value not in self.notes[kind]:
                    raise Blocked("BROKEN_NOTE_REFERENCE")
                dst.set(key, self.notes[kind][value])
            elif (attr == "numId" or local == "numId" and attr == "val"):
                if value == "0":
                    dst.set(key, "0")
                elif value in self.number_ids:
                    dst.set(key, self.number_ids[value])
                else:
                    raise Blocked("BROKEN_NUMBERING_REFERENCE")
            elif (attr == "abstractNumId" or local == "abstractNumId" and attr == "val"):
                if value not in self.abstract_ids:
                    raise Blocked("BROKEN_NUMBERING_REFERENCE")
                dst.set(key, self.abstract_ids[value])
            elif local == "lvlText" and attr == "val":
                if re.fullmatch(r"[\s%0-9.()\-•·▪◦\uf0b7]{0,40}", value):
                    dst.set(key, value)
                else:
                    dst.set(key, "%1.")
                    self.redaction.issues.add("NUMBERING_TEXT_REPLACED")
            elif attr in NUMERIC or attr == "val" and local in {"sz", "szCs", "position", "outlineLvl", "ilvl", "start", "lvlRestart"}:
                if re.fullmatch(r"-?\d{1,9}", value):
                    dst.set(key, value)
            elif attr in {"color", "fill"} or local == "color" and attr == "val":
                if value == "auto" or re.fullmatch(r"[0-9A-Fa-f]{6}", value):
                    dst.set(key, value)
            elif attr in ENUMS and value in ENUMS[attr]:
                dst.set(key, value)
            elif attr in {"val", "default", "customStyle", "equalWidth", "sep"} and value in {"0", "1"}:
                dst.set(key, value)

    def clean(self, node) -> list:
        if not isinstance(node.tag, str):
            return []
        qname = ET.QName(node)
        local = qname.localname
        if qname.namespace == MC and local == "AlternateContent":
            choice = next((x for x in node if ET.QName(x).localname == "Choice"), None)
            if choice is None:
                choice = next(iter(node), None)
            return self.children(choice) if choice is not None else []
        if qname.namespace != W:
            if "".join(node.itertext()).strip():
                self.redaction.issues.add("UNSUPPORTED_XML_CONTENT")
            return []
        if local in DROP:
            return []
        if local == "r" and self.hidden_run(node):
            self.redaction.categories.add("HIDDEN_TEXT_REMOVED")
            return []
        if local in GRAPHICS:
            if local in {"altChunk", "subDoc", "control"}:
                self.redaction.issues.add("UNSUPPORTED_OBJECT_REMOVED")
            boxes = node.findall(".//w:txbxContent", NS)
            if boxes:
                self.redaction.issues.add("TEXTBOX_LAYOUT_CHANGED")
                # Flatten text to runs: nested paragraphs within a run would be invalid OOXML.
                run = ET.Element(Q("r"))
                text = ET.SubElement(run, Q("t"))
                text.text = "\n".join("".join(p.itertext(Q("t"))) for box in boxes for p in box.findall(".//w:p", NS))
                return [text] if node.getparent() is not None and node.getparent().tag == Q("r") else [run]
            return []
        if local in {"headerReference", "footerReference"}:
            rid = node.get(f"{{{R}}}id", "")
            if rid not in self.header_refs:
                raise Blocked("BROKEN_HEADER_REFERENCE")
            dst = ET.Element(Q(local))
            dst.set(f"{{{R}}}id", self.header_refs[rid])
            if node.get(Q("type")) in {"default", "first", "even"}:
                dst.set(Q("type"), node.get(Q("type")))
            return [dst]
        if local in WRAPPERS:
            return self.children(node)
        if local in {"vanish", "webHidden"}:
            return []
        if local not in CONTENT | PROPS:
            if local == "rFonts":
                return []
            if next(node.iter(Q("t")), None) is not None:
                raise Blocked("UNSUPPORTED_TEXT_CONTAINER")
            self.redaction.issues.add("UNSUPPORTED_XML_PROPERTY")
            return []
        dst = ET.Element(Q(local))
        self.attrs(node, dst, local)
        if local == "t":
            dst.text = node.text or ""
            dst.set(f"{{{XML}}}space", "preserve")
        else:
            dst.extend(self.children(node))
        return [dst]

    def children(self, node):
        return [clean for child in node for clean in self.clean(child)]

    def redact_story(self, root):
        # Identity labels often occupy the left cell, and the value the right cell.
        for row in root.iter(Q("tr")):
            cells = row.findall(Q("tc"))
            cell_texts = tuple("".join(cell.itertext(Q("t"))) for cell in cells)
            if any(STUDY_TYPE_LABEL.match(value) for value in cell_texts):
                self.study_type_rows.append(cell_texts)
            for i in range(len(cells) - 1):
                label = " ".join(cells[i].itertext(Q("t"))).strip()
                if SERVICE_DATE_LABEL_ONLY.fullmatch(label):
                    nodes = list(cells[i].iter(Q("t"))) + list(cells[i + 1].iter(Q("t")))
                    if any((n.text or "").strip() for n in nodes):
                        for n in nodes:
                            n.text = ""
                        self.redaction.count += 1
                        self.redaction.categories.add("SERVICE_EXAM_DATE_REMOVED")
                    continue
                if STANDALONE_LABEL.fullmatch(label):
                    nodes = list(cells[i + 1].iter(Q("t")))
                    if any((n.text or "").strip() for n in nodes):
                        for n in nodes:
                            n.text = ""
                        nodes[0].text = REMOVED
                        self.redaction.count += 1
                        self.redaction.categories.add("TABLE_IDENTITY_FIELD")
        for paragraph in root.iter(Q("p")):
            nodes = text_nodes(paragraph)
            original = "".join(node.text or "" for node in nodes)
            self.study_type_texts.extend(study_type_lines(original))
            redact_nodes(nodes, self.redaction)

    def build(self) -> dict[str, bytes]:
        self.inspect()
        relationships = []
        # All header/footer IDs and filenames are regenerated. Orphan stories are discarded.
        doc_rels = self.package.get("word/_rels/document.xml.rels")
        used_ids = set(self.story_roots["word/document.xml"].xpath("//w:headerReference/@r:id | //w:footerReference/@r:id", namespaces=NS))
        stories = [("word/document.xml", "word/document.xml")]
        if doc_rels:
            for relation in parse(doc_rels):
                rid = relation.get("Id", "")
                typ = relation.get("Type", "").rsplit("/", 1)[-1]
                if rid not in used_ids or typ not in {"header", "footer"}:
                    continue
                target = relation.get("Target", "")
                if relation.get("TargetMode") == "External" or not re.fullmatch(r"(?:/word/)?(?:header|footer)\d+\.xml", target):
                    raise Blocked("UNSAFE_HEADER_TARGET")
                source = "word/" + target.rsplit("/", 1)[-1]
                if source not in self.story_roots:
                    raise Blocked("BROKEN_HEADER_REFERENCE")
                newrid = f"rId{len(relationships) + 1}"
                newname = f"{typ}{len(relationships) + 1}.xml"
                self.header_refs[rid] = newrid
                relationships.append((newrid, typ, newname))
                stories.append((source, "word/" + newname))
        for kind in ("footnotes", "endnotes"):
            if f"word/{kind}.xml" in self.story_roots:
                stories.append((f"word/{kind}.xml", f"word/{kind}.xml"))
                relationships.append((f"rId{len(relationships)+1}", kind, f"{kind}.xml"))
        for source, target in stories:
            cleaned = self.clean(self.story_roots[source])[0]
            self.redact_story(cleaned)
            self.parts[target] = xml(cleaned)
        for kind in ("styles", "numbering"):
            source = f"word/{kind}.xml"
            if source in self.package:
                cleaned = self.clean(parse(self.package[source]))[0]
                self.parts[source] = xml(cleaned)
                relationships.append((f"rId{len(relationships)+1}", kind, f"{kind}.xml"))
        # Word requires at least a final paragraph in every table cell.
        for name in list(self.parts):
            root = parse(self.parts[name])
            for cell in root.iter(Q("tc")):
                if len(cell) == 0 or cell[-1].tag != Q("p"):
                    ET.SubElement(cell, Q("p"))
            self.parts[name] = xml(root)
        relroot = ET.Element(f"{{{REL}}}Relationships", nsmap={None: REL})
        for rid, kind, target in relationships:
            ET.SubElement(relroot, f"{{{REL}}}Relationship", Id=rid, Type=R+"/"+kind, Target=target)
        self.parts["word/_rels/document.xml.rels"] = xml(relroot)
        rootrels = ET.Element(f"{{{REL}}}Relationships", nsmap={None: REL})
        ET.SubElement(rootrels, f"{{{REL}}}Relationship", Id="rId1", Type=R+"/officeDocument", Target="word/document.xml")
        self.parts["_rels/.rels"] = xml(rootrels)
        types = ET.Element(f"{{{CT}}}Types", nsmap={None: CT})
        ET.SubElement(types, f"{{{CT}}}Default", Extension="rels", ContentType="application/vnd.openxmlformats-package.relationships+xml")
        for name in self.parts:
            if not name.endswith(".xml"):
                continue
            stem = PurePosixPath(name).stem
            kind = "header" if stem.startswith("header") else "footer" if stem.startswith("footer") else stem
            suffix = "document.main" if kind == "document" else kind
            ET.SubElement(types, f"{{{CT}}}Override", PartName="/"+name, ContentType=f"application/vnd.openxmlformats-officedocument.wordprocessingml.{suffix}+xml")
        self.parts["[Content_Types].xml"] = xml(types)
        if not "".join(parse(self.parts["word/document.xml"]).itertext(Q("t"))).strip():
            self.redaction.issues.add("EMPTY_MAIN_TEXT")
        return self.parts


def text_nodes(paragraph):
    nodes = []
    for n in paragraph.iter():
        if n.tag == Q("t"):
            nodes.append(n)
        elif n.tag in {Q("br"), Q("cr"), Q("tab")}:
            virtual = ET.Element("separator")
            virtual.text = "\t" if n.tag == Q("tab") else "\n"
            nodes.append(virtual)
    return nodes


def verify(parts: dict[str, bytes], required_study_types=(), required_study_rows=()) -> set[str]:
    """Independent postcondition scan over the actual emitted package."""
    issues = set()
    allowed = {"[Content_Types].xml", "_rels/.rels", "word/_rels/document.xml.rels", "word/styles.xml", "word/numbering.xml"}
    forbidden = DROP | GRAPHICS | {"vanish", "webHidden", "instrText", "delText", "txbxContent", "hyperlink"}
    found_study_types = []
    found_study_rows = []
    for name, data in parts.items():
        if name not in allowed and not STORY.fullmatch(name):
            raise Blocked("VERIFY_UNEXPECTED_PART")
        root = parse(data)
        if name.endswith(".rels"):
            ids = set()
            for node in root:
                if node.get("TargetMode") is not None:
                    raise Blocked("VERIFY_EXTERNAL_LINK")
                target = node.get("Target", "")
                resolved = target if name == "_rels/.rels" else "word/" + target
                if resolved not in parts or node.get("Id") in ids:
                    raise Blocked("VERIFY_BROKEN_RELATIONSHIP")
                ids.add(node.get("Id"))
            continue
        if not name.startswith("word/"):
            continue
        for row in root.iter(Q("tr")):
            cell_texts = tuple("".join(cell.itertext(Q("t"))) for cell in row.findall(Q("tc")))
            if any(STUDY_TYPE_LABEL.match(value) for value in cell_texts):
                found_study_rows.append(cell_texts)
        for node in root.iter():
            if not isinstance(node.tag, str) or ET.QName(node).namespace != W:
                raise Blocked("VERIFY_UNEXPECTED_NAMESPACE")
            local = ET.QName(node).localname
            if local in forbidden or local not in CONTENT | PROPS | {"headerReference", "footerReference"}:
                raise Blocked("VERIFY_FORBIDDEN_ELEMENT")
            parent = node.getparent()
            parentlocal = ET.QName(parent).localname if parent is not None else ""
            parents = {
                "body": {"document"}, "p": {"body", "tc", "hdr", "ftr", "footnote", "endnote"},
                "r": {"p"}, "t": {"r"}, "tbl": {"body", "tc", "hdr", "ftr", "footnote", "endnote"},
                "tr": {"tbl"}, "tc": {"tr"}, "footnote": {"footnotes"}, "endnote": {"endnotes"},
                "headerReference": {"sectPr"}, "footerReference": {"sectPr"},
            }
            if local in parents and parentlocal not in parents[local]:
                raise Blocked("VERIFY_INVALID_STRUCTURE")
            for key in node.attrib:
                q = ET.QName(key)
                if q.namespace not in {W, XML, R} or q.localname in {"author", "date", "rsidR", "rsidDel"}:
                    raise Blocked("VERIFY_METADATA_ATTRIBUTE")
        for p in root.iter(Q("p")):
            text = "".join(n.text or "" for n in text_nodes(p))
            found_study_types.extend(study_type_lines(text))
            if service_date_spans(text):
                raise Blocked("VERIFY_RESIDUAL_SERVICE_DATE")
            residual = Redaction()
            if spans(text, residual):
                raise Blocked("VERIFY_RESIDUAL_IDENTIFIER")
            issues.update(suspicious(text))
    for expected in required_study_types:
        if found_study_types.count(expected) < required_study_types.count(expected):
            raise Blocked("VERIFY_STUDY_TYPE_CHANGED")
    for expected in required_study_rows:
        if found_study_rows.count(expected) < required_study_rows.count(expected):
            raise Blocked("VERIFY_STUDY_TYPE_CHANGED")
    return issues


def package_bytes(parts) -> bytes:
    stream = BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name, data in sorted(parts.items()):
            # Fixed timestamp and no original ZIP attributes or comments.
            item = zipfile.ZipInfo(name, date_time=(2000, 1, 1, 0, 0, 0))
            item.compress_type = zipfile.ZIP_DEFLATED
            archive.writestr(item, data)
    return stream.getvalue()


def process(path: Path, case_id: str) -> tuple[Result, bytes | None]:
    result = Result(case_id)
    try:
        builder = Rebuilder(read_package(path))
        parts = builder.build()
        result.removed_fields = builder.redaction.count
        result.removed_images = builder.images
        result.categories = sorted(builder.redaction.categories | builder.redaction.issues)
        issues = builder.redaction.issues | verify(parts, builder.study_type_texts, builder.study_type_rows)
        blob = package_bytes(parts)
        with zipfile.ZipFile(BytesIO(blob)) as archive:
            if archive.testzip() is not None:
                raise Blocked("VERIFY_ZIP_CRC")
            actual = {n: archive.read(n) for n in archive.namelist()}
        issues |= verify(actual, builder.study_type_texts, builder.study_type_rows)
        result.removed_fields = builder.redaction.count
        result.removed_images = builder.images
        result.categories = sorted(builder.redaction.categories | issues)
        result.status = "REVIEW" if issues else "PASS"
        return result, blob
    except Blocked as exc:
        result.reason = str(exc)
    except (zipfile.BadZipFile, zipfile.LargeZipFile, EOFError):
        result.reason = "INVALID_ZIP"
    except (OSError, PermissionError):
        result.reason = "LOCAL_IO_ERROR"
    except Exception:
        # Neither exception messages nor input paths are exposed to logs or reports.
        result.reason = "PROCESSING_FAILED"
    return result, None
