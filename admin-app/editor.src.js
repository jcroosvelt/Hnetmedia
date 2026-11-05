/**
 * Éditeur d'articles HNet Media — basé sur TipTap (ProseMirror, licence MIT).
 * Source du fichier admin-app/editor.js (généré : `npm run build:editor`).
 *
 * Contenu produit : HTML limité à une liste blanche (p, h2-h4, strong, em, u, s,
 * ul/ol/li, blockquote, hr, a, figure/img/figcaption, table). Le serveur le
 * nettoie une seconde fois : rien de ce qui est fait ici ne dispense de cette
 * validation.
 */
import { Editor, Node } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import { TableKit } from "@tiptap/extension-table";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";

/* ── Image légendée : <figure><img alt><figcaption> ── */
const Figure = Node.create({
  name: "figure",
  group: "block",
  atom: true,
  draggable: true,
  selectable: true,
  addAttributes() {
    return { src: { default: null }, alt: { default: "" }, caption: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "figure",
        getAttrs: (el) => {
          const img = el.querySelector("img");
          if (!img || !img.getAttribute("src")) return false;
          const cap = el.querySelector("figcaption");
          return { src: img.getAttribute("src"), alt: img.getAttribute("alt") || "", caption: cap ? cap.textContent.trim() : "" };
        },
      },
      { tag: "img[src]", getAttrs: (el) => ({ src: el.getAttribute("src"), alt: el.getAttribute("alt") || "", caption: "" }) },
    ];
  },
  renderHTML({ node }) {
    const { src, alt, caption } = node.attrs;
    const kids = [["img", { src, alt, loading: "lazy" }]];
    if (caption) kids.push(["figcaption", {}, caption]);
    return ["figure", {}, ...kids];
  },
  addCommands() {
    return {
      // Un paragraphe vide suit l'image : le curseur y passe pour continuer à écrire.
      setFigure: (attrs) => ({ commands }) => commands.insertContent([{ type: this.name, attrs }, { type: "paragraph" }]),
      updateFigure: (attrs) => ({ commands }) => commands.updateAttributes(this.name, attrs),
    };
  },
});

/* ── Validation des liens et images (côté éditeur ; le serveur revalide) ── */
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
function httpsUrl(raw) {
  try {
    const u = new URL(String(raw || "").trim());
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

const ICONS = {
  undo: "↶", redo: "↷", bold: "G", italic: "I", underline: "S", strike: "S", link: "🔗", unlink: "⛓",
  bullet: "•≡", ordered: "1.", quote: "❝", hr: "—", image: "🖼", table: "▦", clear: "Tx", full: "⤢",
};

/**
 * root : élément conteneur.
 * opts : { html, placeholder, ask(title, fields, {submit}) -> Promise<values|null>, onChange(html) }
 */
function create(root, opts = {}) {
  const ask = opts.ask;
  root.classList.add("hn-ed");
  root.innerHTML = "";

  const toolbar = document.createElement("div");
  toolbar.className = "hn-ed-toolbar";
  toolbar.setAttribute("role", "toolbar");
  toolbar.setAttribute("aria-label", "Mise en forme");
  const content = document.createElement("div");
  content.className = "hn-ed-content article-body";
  const status = document.createElement("div");
  status.className = "hn-ed-status";
  status.setAttribute("aria-live", "polite");
  root.append(toolbar, content, status);

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

  /* ── Barre d'outils ── */
  const buttons = [];
  const sep = () => { const s = document.createElement("span"); s.className = "hn-ed-sep"; s.setAttribute("aria-hidden", "true"); toolbar.append(s); };
  function btn(id, label, title, run, isActive, isEnabled) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "hn-ed-btn hn-ed-" + id;
    b.title = title;
    b.setAttribute("aria-label", title);
    b.innerHTML = `<span aria-hidden="true">${label}</span>`;
    b.addEventListener("mousedown", (e) => e.preventDefault()); // garde la sélection
    b.addEventListener("click", () => { run(); });
    toolbar.append(b);
    buttons.push({ b, isActive, isEnabled });
    return b;
  }

  btn("undo", ICONS.undo, "Annuler (Ctrl+Z)", () => editor.chain().focus().undo().run(), null, () => editor.can().undo());
  btn("redo", ICONS.redo, "Rétablir (Ctrl+Y)", () => editor.chain().focus().redo().run(), null, () => editor.can().redo());
  sep();

  const sel = document.createElement("select");
  sel.className = "hn-ed-select";
  sel.setAttribute("aria-label", "Style de paragraphe");
  sel.innerHTML = '<option value="p">Paragraphe</option><option value="2">Intertitre (H2)</option><option value="3">Sous-titre (H3)</option><option value="4">Rubrique (H4)</option>';
  sel.addEventListener("change", () => {
    const v = sel.value;
    const ch = editor.chain().focus();
    if (v === "p") ch.setParagraph().run(); else ch.setHeading({ level: Number(v) }).run();
  });
  toolbar.append(sel);
  sep();

  btn("bold", "<b>G</b>", "Gras (Ctrl+B)", () => editor.chain().focus().toggleBold().run(), () => editor.isActive("bold"));
  btn("italic", "<i>I</i>", "Italique (Ctrl+I)", () => editor.chain().focus().toggleItalic().run(), () => editor.isActive("italic"));
  btn("underline", "<u>S</u>", "Souligné (Ctrl+U)", () => editor.chain().focus().toggleUnderline().run(), () => editor.isActive("underline"));
  btn("strike", "<s>B</s>", "Barré", () => editor.chain().focus().toggleStrike().run(), () => editor.isActive("strike"));
  sep();

  async function editLink() {
    const prev = editor.getAttributes("link").href || "";
    const v = await ask("Lien", [{ name: "href", label: "Adresse (https://… ou e-mail)", value: prev, required: true, type: "text" }], {
      submit: "Appliquer",
      validate: (x) => (normalizeLink(x.href) ? "" : "Adresse invalide. Utilisez une adresse https://, http:// ou une adresse e-mail."),
    });
    if (!v) return;
    editor.chain().focus().extendMarkRange("link").setLink({ href: normalizeLink(v.href) }).run();
  }
  btn("link", ICONS.link, "Lien (Ctrl+K)", editLink, () => editor.isActive("link"));
  btn("unlink", ICONS.unlink, "Retirer le lien", () => editor.chain().focus().extendMarkRange("link").unsetLink().run(), null, () => editor.isActive("link"));
  sep();

  btn("bullet", ICONS.bullet, "Liste à puces", () => editor.chain().focus().toggleBulletList().run(), () => editor.isActive("bulletList"));
  btn("ordered", ICONS.ordered, "Liste numérotée", () => editor.chain().focus().toggleOrderedList().run(), () => editor.isActive("orderedList"));
  btn("quote", ICONS.quote, "Citation", () => editor.chain().focus().toggleBlockquote().run(), () => editor.isActive("blockquote"));
  btn("hr", ICONS.hr, "Séparateur", () => editor.chain().focus().setHorizontalRule().run());
  sep();

  async function editFigure() {
    const cur = editor.isActive("figure") ? editor.getAttributes("figure") : null;
    const v = await ask(cur ? "Modifier l'image" : "Insérer une image", [
      { name: "src", label: "Adresse de l'image (https://…)", value: cur ? cur.src : "", required: true, type: "text" },
      { name: "alt", label: "Texte alternatif (obligatoire : décrit l'image aux lecteurs d'écran)", value: cur ? cur.alt : "", required: true, type: "text" },
      { name: "caption", label: "Légende et crédit (ex. « Le port de Jacmel. Photo : Nom Prénom »)", value: cur ? cur.caption : "", type: "text" },
    ], {
      submit: cur ? "Enregistrer" : "Insérer",
      validate: (x) => (!httpsUrl(x.src) ? "L'adresse de l'image doit commencer par https://" : !String(x.alt || "").trim() ? "Le texte alternatif est obligatoire." : ""),
    });
    if (!v) return;
    const attrs = { src: httpsUrl(v.src), alt: v.alt.trim(), caption: String(v.caption || "").trim() };
    if (cur) editor.chain().focus().updateFigure(attrs).run(); else editor.chain().focus().setFigure(attrs).run();
  }
  btn("image", ICONS.image, "Image (adresse https)", editFigure, () => editor.isActive("figure"));
  btn("table", ICONS.table, "Insérer un tableau", () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(), null, () => !editor.isActive("table"));

  const tableOps = [
    ["row-add", "+L", "Ajouter une ligne", () => editor.chain().focus().addRowAfter().run(), () => editor.can().addRowAfter()],
    ["col-add", "+C", "Ajouter une colonne", () => editor.chain().focus().addColumnAfter().run(), () => editor.can().addColumnAfter()],
    ["row-del", "−L", "Supprimer la ligne", () => editor.chain().focus().deleteRow().run(), () => editor.can().deleteRow()],
    ["col-del", "−C", "Supprimer la colonne", () => editor.chain().focus().deleteColumn().run(), () => editor.can().deleteColumn()],
    ["tbl-del", "✕▦", "Supprimer le tableau", () => editor.chain().focus().deleteTable().run(), () => editor.can().deleteTable()],
  ].map(([id, l, t, run, en]) => btn(id, l, t, run, null, en));
  sep();

  btn("clear", ICONS.clear, "Effacer la mise en forme", () => editor.chain().focus().clearNodes().unsetAllMarks().run());
  btn("full", ICONS.full, "Plein écran", () => {
    const on = root.classList.toggle("hn-ed-full");
    document.documentElement.classList.toggle("hn-ed-lock", on);
    if (on) editor.commands.focus();
  });

  /* Ctrl+K : lien */
  content.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); editLink(); }
    if (e.key === "Escape" && root.classList.contains("hn-ed-full")) { root.classList.remove("hn-ed-full"); document.documentElement.classList.remove("hn-ed-lock"); }
  });

  /* ── État de la barre et compteurs ── */
  function refresh() {
    for (const { b, isActive, isEnabled } of buttons) {
      if (isActive) { const on = !!isActive(); b.classList.toggle("is-active", on); b.setAttribute("aria-pressed", String(on)); }
      if (isEnabled) b.disabled = !isEnabled();
    }
    const inTable = editor.isActive("table");
    tableOps.forEach((b) => { b.hidden = !inTable; });
    const h = [2, 3, 4].find((l) => editor.isActive("heading", { level: l }));
    sel.value = h ? String(h) : "p";
    const words = editor.storage.characterCount.words();
    const chars = editor.storage.characterCount.characters();
    const mins = Math.max(1, Math.round(words / 200));
    status.textContent = `${words} mot${words > 1 ? "s" : ""} · ${chars} caractère${chars > 1 ? "s" : ""} · lecture ≈ ${mins} min`;
  }

  function getHTML() {
    return editor.isEmpty ? "" : editor.getHTML();
  }

  refresh();
  return {
    editor,
    getHTML,
    setHTML(html) { editor.commands.setContent(html || "", { emitUpdate: false }); refresh(); },
    focus() { editor.commands.focus(); },
    stats() { return { words: editor.storage.characterCount.words(), characters: editor.storage.characterCount.characters() }; },
    destroy() { document.documentElement.classList.remove("hn-ed-lock"); editor.destroy(); root.innerHTML = ""; },
  };
}

window.HNetEditor = { create };
