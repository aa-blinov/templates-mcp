# Screenshots

The folder holds no picture of the interface, and the repository does not
miss one.

There are three visible pages in this product and none of them is pictured
in the tree: the landing page at `/`, and the install and callback pages
that the OAuth flow hands out. The only image the repository carries is the
MCP mark, and it sits in `mcp-stdio/icon.png` because the README shows it
there and because the desktop extension needs it in the bundle.

The tools themselves have no picture either. A tool is a JSON-RPC method
with a description, and the surface a reader sees is what an
assistant does with it.

## What would go here

A screenshot of the landing page, if a fork changes it, and a screenshot of
the OAuth pages when their styling is on. Both are taken from a browser,
and both belong in this folder:

```markdown
![The landing page](docs/screenshots/landing.png)
```

A relative path resolves both on GitHub and in a local checkout, and the
house-style checker verifies that every image reference points at a file
that exists, so a renamed picture cannot quietly break the README.
