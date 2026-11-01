// Stands in for `@pierre/theming/themes` in the GUI bundle (see vite.config.ts): only the two themes the diff uses, not
// every Shiki theme.
const loaders: Record<string, () => Promise<unknown>> = {
  "pierre-dark": () => import("@pierre/theme/pierre-dark"),
  "pierre-light": () => import("@pierre/theme/pierre-light"),
}

export const themes = {
  getTheme: (name: string) => {
    const load = loaders[name]
    return load ? { load } : undefined
  },
}
