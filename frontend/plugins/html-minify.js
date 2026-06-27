/** Минификация HTML в prod-сборке: меньше размер, быстрее загрузка. */
export function htmlMinifyPlugin() {
  return {
    name: 'html-minify',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html, ctx) {
        if (ctx.server) {
          return html;
        }

        return html
          .replace(/<!--[\s\S]*?-->/g, '')
          .replace(/>\s+</g, '><')
          .replace(/\s{2,}/g, ' ')
          .trim();
      },
    },
  };
}
