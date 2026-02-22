export default {
  "*.{ts,tsx,js,jsx,json,css}": "oxfmt --write",
  "*.md": (files) => {
    const safe = files.filter((f) => !f.includes("/apps/docs/content/"));
    return safe.length > 0 ? `oxfmt --write ${safe.join(" ")}` : [];
  },
};
