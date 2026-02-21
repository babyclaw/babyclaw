export default defineAppConfig({
  ui: {
    colors: {
      primary: "rose",
      neutral: "zinc",
    },
    footer: {
      slots: {
        root: "border-t border-default",
        left: "text-sm text-muted",
      },
    },
  },
  seo: {
    siteName: "BabyClaw",
  },
  header: {
    title: "",
    to: "/",
    logo: {
      alt: "",
      light: "",
      dark: "",
    },
    search: true,
    colorMode: true,
    links: [
      {
        icon: "i-simple-icons-github",
        to: "https://github.com/babyclaw/babyclaw",
        target: "_blank",
        "aria-label": "GitHub",
      },
    ],
  },
  footer: {
    credits: `BabyClaw • © ${new Date().getFullYear()}`,
    colorMode: false,
    links: [
      {
        icon: "i-simple-icons-github",
        to: "https://github.com/babyclaw/babyclaw",
        target: "_blank",
        "aria-label": "BabyClaw on GitHub",
      },
    ],
  },
  toc: {
    title: "Table of Contents",
    bottom: {
      title: "Links",
      edit: "https://github.com/babyclaw/babyclaw/edit/main/apps/docs/content",
      links: [
        {
          icon: "i-lucide-star",
          label: "Star on GitHub",
          to: "https://github.com/babyclaw/babyclaw",
          target: "_blank",
        },
        {
          icon: "i-lucide-book-open",
          label: "ClawHub Skills",
          to: "https://clawhub.ai",
          target: "_blank",
        },
      ],
    },
  },
});
