/**
 * Éditeur d'articles HNet Media — basé sur TipTap (ProseMirror, licence MIT).
 * Source du fichier admin-app/editor.js (généré : `npm run build:editor`).
 *
 * Présentation façon traitement de texte : un RUBAN à onglets (Accueil, Insertion, Tableau — qui
 * n'apparaît que dans un tableau —, puis les onglets ajoutés par la page, ex. Affichage).
 *
 * Contenu produit : HTML limité à une liste blanche (p, h2-h4, strong, em, u, s, ul/ol/li, blockquote,
 * hr, a, figure/img/figcaption, table, alignement du texte). Le serveur le nettoie une seconde fois :
 * rien de ce qui est fait ici ne dispense de cette validation.
 */
import { Editor, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { NodeSelection } from "@tiptap/pm/state";

/* ── Sources d'image acceptées : https, ou une image téléversée sur ce site ── */
const MEDIA_RE = /^\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const allowedSrc = (s) => MEDIA_RE.test(String(s || "")) || /^https:\/\/[^\s"'<>]+$/i.test(String(s || ""));

/* ── Image légendée : <figure><img alt><figcaption> ── */
const Figure = Node.create({
  name: "figure",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    // size : s (⅓ de la largeur), m (½), l (¾), full (pleine largeur) ; align : center, left, right (le texte entoure l'image).
    return { src: { default: null }, alt: { default: "" }, caption: { default: "" }, size: { default: "full" }, align: { default: "center" } };
  },
  parseHTML() {
    return [
      {
        tag: "figure",
        getAttrs: (el) => {
          const img = el.querySelector("img");
          if (!img || !allowedSrc(img.getAttribute("src"))) return false;
          const cap = el.querySelector("figcaption");
          const cls = el.getAttribute("class") || "";
          const size = (/\bfig-(s|m|l)\b/.exec(cls) || [])[1] || "full";
          const align = (/\bfig-(left|right)\b/.exec(cls) || [])[1] || "center";
          return { src: img.getAttribute("src"), alt: img.getAttribute("alt") || "", caption: cap ? cap.textContent.trim() : "", size, align };
        },
      },
      { tag: "img[src]", getAttrs: (el) => (allowedSrc(el.getAttribute("src")) ? { src: el.getAttribute("src"), alt: el.getAttribute("alt") || "", caption: "" } : false) },
    ];
  },
  renderHTML({ node }) {
    const { src, alt, caption, size, align } = node.attrs;
    const kids = [["img", { src, alt, loading: "lazy" }]];
    if (caption) kids.push(["figcaption", {}, caption]);
    const cls = [size === "s" || size === "m" || size === "l" ? "fig-" + size : "", align === "left" || align === "right" ? "fig-" + align : ""].filter(Boolean).join(" ");
    return ["figure", cls ? { class: cls } : {}, ...kids];
  },
  addCommands() {
    return {
      // Un paragraphe vide suit l'image : le curseur y passe pour continuer à écrire.
      setFigure: (attrs) => ({ commands }) => commands.insertContent([{ type: this.name, attrs }, { type: "paragraph" }]),
      updateFigure: (attrs) => ({ commands }) => commands.updateAttributes(this.name, attrs),
    };
  },
});

/* ── Liens ── */
function normalizeLink(raw) {
  let v = String(raw || "").trim();
  if (!v) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) v = "mailto:" + v;
  else if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = "https://" + v;
  try {
    const u = new URL(v);
    return ["https:", "http:", "mailto:"].includes(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

/* ── Icônes (SVG en ligne, héritent de la couleur du texte) ── */
const ICON = {
  undo: '<path d="M9 14L4 9l5-5M4 9h10.5a5.5 5.5 0 010 11H11"/>',
  redo: '<path d="M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 000 11H13"/>',
  alignLeft: '<path d="M4 6h16M4 10h10M4 14h16M4 18h10"/>',
  alignCenter: '<path d="M4 6h16M7 10h10M4 14h16M7 18h10"/>',
  alignRight: '<path d="M4 6h16M10 10h10M4 14h16M10 18h10"/>',
  alignJustify: '<path d="M4 6h16M4 10h16M4 14h16M4 18h16"/>',
  bullet: '<path d="M10 6h10M10 12h10M10 18h10"/><circle cx="5" cy="6" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.4" fill="currentColor" stroke="none"/>',
  ordered: '<path d="M11 6h9M11 12h9M11 18h9"/><g fill="currentColor" stroke="none" font-family="Inter,Arial,sans-serif" font-size="7" font-weight="700"><text x="3" y="8">1</text><text x="3" y="14">2</text><text x="3" y="20">3</text></g>',
  quote: '<path d="M7 17c-2 0-3-1.4-3-3.4C4 10.8 5.4 9 8 8M17 17c-2 0-3-1.4-3-3.4 0-2.8 1.4-4.6 4-5.6"/>',
  hr: '<path d="M3 12h18"/><path d="M8 6h8M8 18h8" stroke-dasharray="2 3"/>',
  image: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><circle cx="9" cy="10" r="1.3"/><path d="M4 17l4.5-4.5 3.5 3.5 2.5-2.5L20 17"/>',
  table: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M4 14.5h16M10 5v14M15 5v14"/>',
  link: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/>',
  unlink: '<path d="M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1"/><path d="M4 4l16 16"/>',
  clear: '<g fill="currentColor" stroke="none" font-family="Inter,Arial,sans-serif" font-size="14" font-weight="700"><text x="3" y="17">T</text></g><path d="M13 12l7 7M20 12l-7 7"/>',
  rowAbove: '<rect x="4" y="9" width="16" height="10" rx="1"/><path d="M4 14h16M12 3v4M10 5h4"/>',
  rowBelow: '<rect x="4" y="5" width="16" height="10" rx="1"/><path d="M4 10h16M12 17v4M10 19h4"/>',
  colLeft: '<rect x="9" y="5" width="11" height="14" rx="1"/><path d="M14.5 5v14M3 12h4M5 10v4"/>',
  colRight: '<rect x="4" y="5" width="11" height="14" rx="1"/><path d="M9.5 5v14M17 12h4M19 10v4"/>',
  delRow: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M4 15h16"/><path d="M8 7.2l8 0" stroke-width="0"/><path d="M9 11.5l6 2.5M15 11.5l-6 2.5"/>',
  delCol: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M9.5 5v14M14.5 5v14"/><path d="M10.5 10l3 4M13.5 10l-3 4"/>',
  header: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M10 5v14M15 5v14"/><path d="M4.5 5.5h15v4h-15z" fill="currentColor" stroke="none" opacity=".35"/>',
  merge: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 12h5M15 12h5M9 12l2-2M9 12l2 2M15 12l-2-2M15 12l-2 2"/>',
  zoomIn: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.5-4.5M11 8v6M8 11h6"/>',
  zoomOut: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.5-4.5M8 11h6"/>',
  panel: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M15 5v14"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  sizeS: '<rect x="3" y="4" width="18" height="16" rx="1.5" stroke-dasharray="2 2.5"/><rect x="8" y="9" width="8" height="6" rx="1"/>',
  sizeM: '<rect x="3" y="4" width="18" height="16" rx="1.5" stroke-dasharray="2 2.5"/><rect x="6" y="7.5" width="12" height="9" rx="1"/>',
  sizeL: '<rect x="3" y="4" width="18" height="16" rx="1.5" stroke-dasharray="2 2.5"/><rect x="4.5" y="6" width="15" height="12" rx="1"/>',
  sizeFull: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 12h4M17 12h4M5 10l-2 2 2 2M19 10l2 2-2 2"/>',
  imgLeft: '<rect x="4" y="5" width="8" height="7" rx="1"/><path d="M15 6h5M15 9h5M4 15h16M4 19h16"/>',
  imgRight: '<rect x="12" y="5" width="8" height="7" rx="1"/><path d="M4 6h5M4 9h5M4 15h16M4 19h16"/>',
  imgCenter: '<rect x="8" y="9" width="8" height="6" rx="1"/><path d="M4 5h16M4 19h16"/>',
  moveUp: '<path d="M12 19V6M6 11l6-6 6 6"/>',
  moveDown: '<path d="M12 5v13M6 13l6 6 6-6"/>',
  delImg: '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="M8 9l8 6M16 9l-8 6"/>',
  delTable: '<rect x="4" y="5" width="16" height="14" rx="1"/><path d="M4 10h16M4 14.5h16M10 5v14M15 5v14"/><path d="M7 8l10 8M17 8L7 16"/>',
};
const svgIcon = (name, size = 18) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${ICON[name] || ""}</svg>`;

/* ── Petit utilitaire DOM ── */
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  if (props) for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") e.className = v;
    else if (k === "html") e.innerHTML = v;
    else if (k === "text") e.textContent = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? "" : v);
  }
  kids.flat().forEach((c) => c !== null && c !== undefined && c !== false && e.append(c));
  return e;
}

/**
 * opts : {
 *   ribbon, content : éléments conteneurs,
 *   html, placeholder,
 *   ask(title, fields, {submit, validate}) -> Promise<values|null>,
 *   pickImage(current|null) -> Promise<{src, alt, caption}|null>,
 *   extraTabs : [{ id, label, groups:[{ label, items:[item] }] }],
 *   onChange(html), onStats({words, characters, minutes})
 * }
 * item : { id, icon, label, title, big, run(), isActive?(), isEnabled?() }
 */
function create(opts = {}) {
  const { ask, pickImage } = opts;
  const ribbon = opts.ribbon;
  const content = opts.content;
  ribbon.innerHTML = "";
  content.innerHTML = "";

  const editor = new Editor({
    element: content,
    content: opts.html || "",
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3, 4] },
        code: false,
        codeBlock: false,
        link: {
          openOnClick: false,
          autolink: true,
          protocols: ["http", "https", "mailto"],
          HTMLAttributes: { rel: "noopener noreferrer nofollow", target: "_blank" },
        },
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TableKit.configure({ table: { resizable: false } }),
      Figure,
      Placeholder.configure({ placeholder: opts.placeholder || "Rédigez votre article ici…" }),
      CharacterCount,
    ],
    editorProps: {
      attributes: { class: "hn-ed-prose", role: "textbox", "aria-multiline": "true", "aria-label": "Corps de l'article" },
    },
    onUpdate: () => {
      refresh();
      if (opts.onChange) opts.onChange(getHTML());
    },
    onSelectionUpdate: () => refresh(),
  });

  /* ───────── Ruban ───────── */
  const tabsEl = el("div", { class: "wd-tabs", role: "tablist", "aria-label": "Onglets de mise en forme" });
  const panelsEl = el("div", { class: "wd-panels" });
  ribbon.append(tabsEl, panelsEl);
  const tabs = new Map(); // id -> { btn, panel, contextual }
  const items = []; // { node, def }
  let styleSelect = null;

  function showTab(id) {
    const t = tabs.get(id);
    if (!t || t.btn.hidden) return;
    for (const [k, v] of tabs) {
      const on = k === id;
      v.btn.classList.toggle("on", on);
      v.btn.setAttribute("aria-selected", String(on));
      v.panel.hidden = !on;
    }
  }

  function buildItem(def) {
    const b = el("button", {
      type: "button",
      class: `wd-btn hn-ed-${def.id}${def.big ? " big" : ""}`,
      title: def.title || def.label || "",
      "aria-label": def.title || def.label || def.id,
      html: `<span class="wd-ico">${def.iconHtml || svgIcon(def.icon, def.big ? 22 : 18)}</span>${def.big && def.label ? `<span class="wd-lbl">${def.label}</span>` : ""}`,
    });
    // Garde la sélection et le clavier dans le texte lorsqu'on appuie sur un bouton (souris ou doigt).
    const keep = (e) => e.preventDefault();
    b.addEventListener("mousedown", keep);
    b.addEventListener("pointerdown", keep);
    b.addEventListener("click", () => def.run());
    items.push({ node: b, def });
    return b;
  }

  function addTab(def) {
    const btn = el("button", { type: "button", role: "tab", class: "wd-tab", "data-tab": def.id, text: def.label, "aria-selected": "false", hidden: !!def.contextual });
    btn.addEventListener("mousedown", (e) => e.preventDefault());
    btn.addEventListener("click", () => showTab(def.id));
    const panel = el("div", { class: "wd-panel", role: "tabpanel", "data-panel": def.id, hidden: true });
    for (const g of def.groups) {
      const body = el("div", { class: "wd-group-body" });
      for (const it of g.items) body.append(it.type === "select" ? it.node : buildItem(it));
      panel.append(el("div", { class: "wd-group" }, body, el("div", { class: "wd-group-label", text: g.label })));
    }
    tabsEl.append(btn);
    panelsEl.append(panel);
    tabs.set(def.id, { btn, panel, contextual: !!def.contextual });
  }

  const chain = () => editor.chain().focus();
  const can = () => editor.can();

  /* sélecteur de style de paragraphe */
  styleSelect = el("select", { class: "hn-ed-select wd-select", "aria-label": "Style de paragraphe" },
    el("option", { value: "p", text: "Paragraphe" }), el("option", { value: "2", text: "Intertitre (H2)" }),
    el("option", { value: "3", text: "Sous-titre (H3)" }), el("option", { value: "4", text: "Rubrique (H4)" }));
  styleSelect.addEventListener("change", () => {
    const v = styleSelect.value;
    const c = chain();
    if (v === "p") c.setParagraph().run(); else c.setHeading({ level: Number(v) }).run();
  });

  async function editLink() {
    const prev = editor.getAttributes("link").href || "";
    const v = await ask("Lien", [{ name: "href", label: "Adresse (https://… ou e-mail)", value: prev, required: true, type: "text" }], {
      submit: "Appliquer",
      validate: (x) => (normalizeLink(x.href) ? "" : "Adresse invalide. Utilisez une adresse https://, http:// ou une adresse e-mail."),
    });
    if (!v) return;
    chain().extendMarkRange("link").setLink({ href: normalizeLink(v.href) }).run();
  }

  async function editFigure() {
    const cur = editor.isActive("figure") ? editor.getAttributes("figure") : null;
    const v = await pickImage(cur ? { src: cur.src, alt: cur.alt, caption: cur.caption } : null);
    if (!v || !allowedSrc(v.src)) return;
    const attrs = { src: v.src, alt: String(v.alt || "").trim(), caption: String(v.caption || "").trim() };
    if (cur) chain().updateFigure(attrs).run(); else chain().setFigure(attrs).run();
  }

  /* Taille et position de l'image sélectionnée */
  const figAttrs = () => (editor.isActive("figure") ? editor.getAttributes("figure") : null);
  function setFigSize(size) {
    const cur = figAttrs(); if (!cur) return;
    // Une image à côté du texte ne peut pas occuper toute la largeur : on la recentre.
    const attrs = { size };
    if (size === "full" && cur.align !== "center") attrs.align = "center";
    chain().updateFigure(attrs).run();
  }
  function setFigAlign(align) {
    const cur = figAttrs(); if (!cur) return;
    const attrs = { align };
    // Pour que le texte entoure l'image, elle ne doit pas être pleine largeur : taille moyenne par défaut.
    if (align !== "center" && cur.size === "full") attrs.size = "m";
    chain().updateFigure(attrs).run();
  }
  // Déplace l'image d'un bloc vers le haut (-1) ou le bas (+1) ; le glisser-déposer reste possible à la souris.
  function figIndex() {
    const sel = editor.state.selection;
    if (!(sel instanceof NodeSelection) || sel.node.type.name !== "figure") return null;
    const $pos = editor.state.doc.resolve(sel.from);
    return { sel, parent: $pos.parent, index: $pos.index() };
  }
  function canMoveFig(dir) {
    const f = figIndex(); if (!f) return false;
    const target = f.index + dir;
    return target >= 0 && target < f.parent.childCount;
  }
  function moveFig(dir) {
    const f = figIndex(); if (!f || !canMoveFig(dir)) return;
    const { sel, parent, index } = f;
    const node = sel.node, start = sel.from, end = sel.to;
    let tr = editor.state.tr.delete(start, end);
    const insertAt = dir < 0 ? start - parent.child(index - 1).nodeSize : start + parent.child(index + 1).nodeSize;
    tr = tr.insert(insertAt, node);
    tr = tr.setSelection(NodeSelection.create(tr.doc, insertAt)).scrollIntoView();
    editor.view.dispatch(tr);
    editor.view.focus();
  }

  async function insertTable() {
    const v = await ask("Insérer un tableau", [
      { name: "rows", label: "Nombre de lignes", type: "number", value: "3", min: 1, required: true },
      { name: "cols", label: "Nombre de colonnes", type: "number", value: "3", min: 1, required: true },
      { name: "header", label: "Première ligne", type: "select", value: "1", options: [["1", "En-tête (en gras)"], ["0", "Ligne ordinaire"]] },
    ], {
      submit: "Insérer",
      validate: (x) => {
        const r = parseInt(x.rows, 10), c = parseInt(x.cols, 10);
        return Number.isInteger(r) && Number.isInteger(c) && r >= 1 && r <= 30 && c >= 1 && c <= 8 ? "" : "Choisissez de 1 à 30 lignes et de 1 à 8 colonnes.";
      },
    });
    if (!v) return;
    chain().insertTable({ rows: parseInt(v.rows, 10), cols: parseInt(v.cols, 10), withHeaderRow: v.header === "1" }).run();
    showTab("tableau");
  }

  const A = (id, icon, title, run, isActive, isEnabled, extra = {}) => ({ id, icon, title, run, isActive, isEnabled, ...extra });

  addTab({
    id: "accueil", label: "Accueil",
    groups: [
      { label: "Annuler", items: [
        A("undo", "undo", "Annuler (Ctrl+Z)", () => chain().undo().run(), null, () => can().undo()),
        A("redo", "redo", "Rétablir (Ctrl+Y)", () => chain().redo().run(), null, () => can().redo()),
      ] },
      { label: "Style", items: [{ type: "select", node: styleSelect }] },
      { label: "Police", items: [
        A("bold", null, "Gras (Ctrl+B)", () => chain().toggleBold().run(), () => editor.isActive("bold"), null, { iconHtml: "<b>G</b>" }),
        A("italic", null, "Italique (Ctrl+I)", () => chain().toggleItalic().run(), () => editor.isActive("italic"), null, { iconHtml: "<i>I</i>" }),
        A("underline", null, "Souligné (Ctrl+U)", () => chain().toggleUnderline().run(), () => editor.isActive("underline"), null, { iconHtml: "<u>S</u>" }),
        A("strike", null, "Barré", () => chain().toggleStrike().run(), () => editor.isActive("strike"), null, { iconHtml: "<s>B</s>" }),
      ] },
      { label: "Paragraphe", items: [
        A("alignLeft", "alignLeft", "Aligner à gauche", () => chain().setTextAlign("left").run(), () => editor.isActive({ textAlign: "left" }) || (!editor.isActive({ textAlign: "center" }) && !editor.isActive({ textAlign: "right" }) && !editor.isActive({ textAlign: "justify" }))),
        A("alignCenter", "alignCenter", "Centrer", () => chain().setTextAlign("center").run(), () => editor.isActive({ textAlign: "center" })),
        A("alignRight", "alignRight", "Aligner à droite", () => chain().setTextAlign("right").run(), () => editor.isActive({ textAlign: "right" })),
        A("alignJustify", "alignJustify", "Justifier", () => chain().setTextAlign("justify").run(), () => editor.isActive({ textAlign: "justify" })),
        A("bullet", "bullet", "Liste à puces", () => chain().toggleBulletList().run(), () => editor.isActive("bulletList")),
        A("ordered", "ordered", "Liste numérotée", () => chain().toggleOrderedList().run(), () => editor.isActive("orderedList")),
        A("quote", "quote", "Citation", () => chain().toggleBlockquote().run(), () => editor.isActive("blockquote")),
      ] },
      { label: "Édition", items: [
        A("link", "link", "Lien (Ctrl+K)", editLink, () => editor.isActive("link")),
        A("unlink", "unlink", "Retirer le lien", () => chain().extendMarkRange("link").unsetLink().run(), null, () => editor.isActive("link")),
        A("clear", "clear", "Effacer la mise en forme", () => chain().clearNodes().unsetAllMarks().run()),
      ] },
    ],
  });

  addTab({
    id: "insertion", label: "Insertion",
    groups: [
      { label: "Illustrations", items: [A("ins-image", "image", "Insérer ou modifier une image", editFigure, () => editor.isActive("figure"), null, { big: true, label: "Image" })] },
      { label: "Tableaux", items: [A("ins-table", "table", "Insérer un tableau", insertTable, null, () => !editor.isActive("table"), { big: true, label: "Tableau" })] },
      { label: "Liens", items: [A("ins-link", "link", "Lien (Ctrl+K)", editLink, () => editor.isActive("link"), null, { big: true, label: "Lien" })] },
      { label: "Texte", items: [
        A("ins-quote", "quote", "Citation", () => chain().toggleBlockquote().run(), () => editor.isActive("blockquote"), null, { big: true, label: "Citation" }),
        A("ins-hr", "hr", "Séparateur horizontal", () => chain().setHorizontalRule().run(), null, null, { big: true, label: "Séparateur" }),
      ] },
    ],
  });

  addTab({
    id: "tableau", label: "Tableau", contextual: true,
    groups: [
      { label: "Lignes et colonnes", items: [
        A("row-above", "rowAbove", "Insérer une ligne au-dessus", () => chain().addRowBefore().run(), null, () => can().addRowBefore(), { big: true, label: "Ligne au-dessus" }),
        A("row-below", "rowBelow", "Insérer une ligne en dessous", () => chain().addRowAfter().run(), null, () => can().addRowAfter(), { big: true, label: "Ligne en dessous" }),
        A("col-left", "colLeft", "Insérer une colonne à gauche", () => chain().addColumnBefore().run(), null, () => can().addColumnBefore(), { big: true, label: "Colonne à gauche" }),
        A("col-right", "colRight", "Insérer une colonne à droite", () => chain().addColumnAfter().run(), null, () => can().addColumnAfter(), { big: true, label: "Colonne à droite" }),
      ] },
      { label: "Supprimer", items: [
        A("row-del", "delRow", "Supprimer la ligne", () => chain().deleteRow().run(), null, () => can().deleteRow(), { big: true, label: "Ligne" }),
        A("col-del", "delCol", "Supprimer la colonne", () => chain().deleteColumn().run(), null, () => can().deleteColumn(), { big: true, label: "Colonne" }),
        A("tbl-del", "delTable", "Supprimer le tableau", () => chain().deleteTable().run(), null, () => can().deleteTable(), { big: true, label: "Tableau" }),
      ] },
      { label: "Cellules", items: [
        A("tbl-header", "header", "Ligne d'en-tête", () => chain().toggleHeaderRow().run(), () => editor.isActive("tableHeader"), () => can().toggleHeaderRow(), { big: true, label: "En-tête" }),
        A("tbl-merge", "merge", "Fusionner ou séparer les cellules", () => chain().mergeOrSplit().run(), null, () => can().mergeOrSplit(), { big: true, label: "Fusionner" }),
      ] },
    ],
  });

  addTab({
    id: "image", label: "Image", contextual: true,
    groups: [
      { label: "Taille", items: [
        A("fig-s", "sizeS", "Petite image (un tiers de la largeur)", () => setFigSize("s"), () => (figAttrs() || {}).size === "s", null, { big: true, label: "Petite" }),
        A("fig-m", "sizeM", "Image moyenne (la moitié de la largeur)", () => setFigSize("m"), () => (figAttrs() || {}).size === "m", null, { big: true, label: "Moyenne" }),
        A("fig-l", "sizeL", "Grande image (trois quarts de la largeur)", () => setFigSize("l"), () => (figAttrs() || {}).size === "l", null, { big: true, label: "Grande" }),
        A("fig-full", "sizeFull", "Pleine largeur", () => setFigSize("full"), () => (figAttrs() || { size: "full" }).size === "full", null, { big: true, label: "Pleine" }),
      ] },
      { label: "Position", items: [
        A("fig-left", "imgLeft", "À gauche, le texte entoure l'image", () => setFigAlign("left"), () => (figAttrs() || {}).align === "left", null, { big: true, label: "À gauche" }),
        A("fig-center", "imgCenter", "Centrée, sans texte à côté", () => setFigAlign("center"), () => (figAttrs() || { align: "center" }).align === "center", null, { big: true, label: "Centrée" }),
        A("fig-right", "imgRight", "À droite, le texte entoure l'image", () => setFigAlign("right"), () => (figAttrs() || {}).align === "right", null, { big: true, label: "À droite" }),
      ] },
      { label: "Déplacer", items: [
        A("fig-up", "moveUp", "Monter l'image d'un bloc", () => moveFig(-1), null, () => canMoveFig(-1), { big: true, label: "Monter" }),
        A("fig-down", "moveDown", "Descendre l'image d'un bloc", () => moveFig(1), null, () => canMoveFig(1), { big: true, label: "Descendre" }),
      ] },
      { label: "Image", items: [
        A("fig-edit", "image", "Changer l'image, sa description ou sa légende", editFigure, null, null, { big: true, label: "Modifier" }),
        A("fig-del", "delImg", "Supprimer l'image", () => chain().deleteSelection().run(), null, null, { big: true, label: "Supprimer" }),
      ] },
    ],
  });

  for (const t of opts.extraTabs || []) addTab(t);

  /* Un clic sur une image la sélectionne (souris comme doigt) : ses réglages de taille et de position s'affichent. */
  content.addEventListener("click", (e) => {
    const fig = e.target.closest && e.target.closest("figure");
    if (!fig || !content.contains(fig)) return;
    try {
      const pos = editor.view.posAtDOM(fig, 0);
      const node = editor.state.doc.nodeAt(pos);
      if (node && node.type.name === "figure") editor.chain().focus().setNodeSelection(pos).run();
    } catch (_) { /* sélection impossible : sans conséquence */ }
  });

  /* Double-clic sur une image : la modifier. Ctrl+K : lien. */
  content.addEventListener("dblclick", (e) => { if (e.target.closest && e.target.closest("figure")) editFigure(); });
  content.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); editLink(); }
  });

  /* ───────── État du ruban et compteurs ───────── */
  let wasOnFig = false, lastFigPos = -1;
  function refresh() {
    for (const { node, def } of items) {
      if (def.isActive) { const on = !!def.isActive(); node.classList.toggle("is-active", on); node.setAttribute("aria-pressed", String(on)); }
      if (def.isEnabled) node.disabled = !def.isEnabled();
    }
    const onFig = editor.isActive("figure");
    const ft = tabs.get("image");
    if (ft) {
      ft.btn.hidden = !onFig;
      const figPos = onFig ? editor.state.selection.from : -1;
      if (onFig && (!wasOnFig || figPos !== lastFigPos)) showTab("image"); // on touche une image (ou une autre) : ses réglages s'affichent
      lastFigPos = figPos;
      if (!onFig && ft.btn.classList.contains("on")) showTab("accueil");
    }
    wasOnFig = onFig;
    const inTable = editor.isActive("table");
    const t = tabs.get("tableau");
    if (t) {
      t.btn.hidden = !inTable;
      if (!inTable && t.btn.classList.contains("on")) showTab("accueil");
    }
    const hl = [2, 3, 4].find((l) => editor.isActive("heading", { level: l }));
    styleSelect.value = hl ? String(hl) : "p";
    if (opts.onStats) {
      const words = editor.storage.characterCount.words();
      const characters = editor.storage.characterCount.characters();
      opts.onStats({ words, characters, minutes: Math.max(1, Math.round(words / 200)) });
    }
  }

  function getHTML() {
    return editor.isEmpty ? "" : editor.getHTML();
  }

  showTab("accueil");
  refresh();
  return {
    editor,
    getHTML,
    setHTML(html) { editor.commands.setContent(html || "", { emitUpdate: false }); refresh(); },
    focus() { editor.commands.focus(); },
    showTab,
    refresh,
    destroy() { editor.destroy(); ribbon.innerHTML = ""; content.innerHTML = ""; },
  };
}

window.HNetEditor = { create, svgIcon };
