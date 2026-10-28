import { Marked } from 'marked';

const escape = (text) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const marked = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    html: ({ text }) => escape(text),
    link({ href, tokens }) {
      const label = this.parser.parseInline(tokens);
      return /^https?:\/\//.test(href) ? `<a href="${escape(href)}" target="_blank" rel="noreferrer">${label}</a>` : label;
    },
    image: ({ text }) => escape(text),
  },
});

export const toHtml = (text) => marked.parse(text);
