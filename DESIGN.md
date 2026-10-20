---
name: bx24-template-mcp
description: The Bitrix24 brand on the landing page, and the SDK badge blue on the two OAuth pages. The project draws no interface of its own beyond those.
colors:
  primary: "#0382ff"
  gradient-end: "#34e9c0"
  surface-text: "#f3f9ff"
  neutral-bg: "#ffffff"
  oauth-accent: "#2fc6f6"
typography:
  body:
    fontFamily: "b24ui font-sans, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  title:
    fontFamily: "b24ui font-sans, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 600
    lineHeight: 1.2
    letterSpacing: "0.22em"
rounded:
  sm: "3px"
  md: "4px"
spacing:
  sm: "10px"
  md: "22px"
  lg: "48px"
---

# Design system: bx24-template-mcp

## Overview

**Creative North Star: "one screen, one paste"**

The product is a server. Its whole visible surface is three pages: the
landing page at `/`, and the install and callback pages that the OAuth flow
hands out. The MCP surface itself is JSON-RPC and has no design at all.

The landing page wears the Bitrix24 house style, because it is a page on
the platform's behalf and the components come from the platform's own
package. What this project draws by hand is small: one gradient and one
underline.

The OAuth pages cannot borrow anything. Their content security policy is
`default-src 'none'` with no external stylesheet and no inline script, so
they carry a stylesheet of their own under a per-response nonce, smaller
than a kilobyte.

What the project rejects: a design system of its own, a web font, a picture
of the tools, and any colour outside the platform's.

Key characteristics:

- One screen, and its job is to get the prompt pasted.
- Two visual languages, and they never meet: the platform's on the landing
  page, a self-contained one on the OAuth pages.
- Every colour is a token, except the two that are documented exceptions.

## Colors

### Primary

- **Brand blue** (`#0382ff`): the colour of the page. It is the bottom of
  the splash gradient, the value in the `theme-color` meta tag and the
  middle of the gradient's sweep.
- **Mint** (`#34e9c0`): the top of the gradient, at 0.21 percent of the
  sweep. It is the only other colour the landing page uses.

### Neutral

- **Ink on blue** (`#f3f9ff`): the text colour of the splash. It is a very
  pale blue rather than white, so the text belongs to the brand.
- **Ink on white** (`#111`): the body text of the OAuth pages, with `#555`
  for the small print and `#f4f4f4` behind a code block.
- **Line** (`#ccc`): the border of an input on the OAuth pages.

### The OAuth accent

- **Badge blue** (`#2fc6f6`): the accent of the install and callback pages,
  taken from the b24jssdk badge. It paints the heading, the links and the
  button, and it darkens to `#20a8d6` under the pointer.

### Named rules

**The brand belongs to Bitrix24.** The landing page wears the platform's
colours because it is a page of the platform's. A fork that wants its own
changes the gradient utility and the one theme tag, and nothing else.

**The exception is written down next to the value.** The splash gradient has
no token in the platform's system, and the small text on its lower band
measures 3.78 to 1 against the background, below the 4.5 to 1 threshold for
small text. It is accepted, and the reason is in a comment in
`assets/css/main.css`: that text is the attribution chrome, not the body
content, and the lede and every interactive element sit on light surfaces.
A change that moves body content into the gradient band has to revisit it.

## Typography

**Display Font:** the platform's sans, `font-sans` from b24ui.
**Body Font:** the same.

The landing page runs a small type scale with one exception, and the
exception is the paragraph.

| Role | Size | What it carries |
| --- | --- | --- |
| Kicker | 13px, uppercase, 0.22em tracking, semibold, 92 percent opacity | "MCP server template", the line under the logotype. |
| Lede | 17px at 1.6 line height, 96 percent opacity | The paragraph that says what the template is. |
| Strapline | 13px, 92 percent opacity | "An official starter by the Bitrix24 team". |
| Caption | 13px, 92 percent opacity | The line above the prompt card. |
| Fine print | 12px, 82 percent opacity | The line below the prompt card. |
| Footer | 13px, 92 percent opacity | The licence, the version and the repository. |

The OAuth pages use the system stack, `-apple-system, BlinkMacSystemFont,
'Segoe UI', sans-serif`, because a web font would need a `font-src` carve-out
that the policy does not have. The body is 16 pixels at 1.5 line height, the
heading is 1.6 rem semibold, the subheading is 1.1 rem, and a code block is
0.9 rem on a grey background.

## Layout

The landing page is one column in the middle of the screen, at most 940
pixels wide, with 48 pixels above and below and 24 at the sides.

```
the Bitrix24 logotype, at most 280px wide and 56% of the viewport
28px
the kicker
6px
the strapline
22px
the lede
32px
the two buttons, 14px apart
40px
the caption over the prompt card
10px
the prompt card
10px
the fine print
22px
the footer, 28px below it
```

The logotype is an inline SVG, so it takes the colour of the text around it
and scales with the viewport.

The OAuth pages are one column, at most 640 pixels wide, centred with a 32
pixel margin and 16 pixels of padding at the sides. The heading, then the
form, then the code block, then the list.

## Elevation & depth

There is no shadow and no layer anywhere. The landing page is a flat
gradient with the text on it, and the OAuth pages are flat white with a
single border on the input. The depth on the landing page belongs to the
platform's components, and the prompt card is the only thing that carries
any.

## Shapes

- **The landing page has no corners.** The whole page is a rectangle with a
  gradient in it.
- **The OAuth input and button** have a radius of 4 pixels, and a code
  block has a radius of 3.
- **The link underline** is 1 pixel, at 32 percent white, and it rises to
  85 percent white on hover and on focus. It is the only underline rule in
  the project.

## Components

### The kicker

One line, 13 pixels, uppercase, tracked out by 0.22 em, semibold, at 92
percent opacity. It names the thing, and it is the only line on the page
that is tracked.

### The lede

17 pixels at 1.6 line height. It is the one paragraph on the page, and it
carries the links, which are underlined and take the border from 50 percent
white to 95 percent white under the pointer.

### The buttons

Two of them, from the platform's own component. They are the secondary
style without the accent, in the medium size, with a 20 pixel icon and a
6 pixel gap between the icon and the label. The first opens the README on
GitHub, the second opens the health endpoint.

### The prompt card

The platform's prompt component, with three actions: copy, Cursor and
Windsurf. It holds a ready-made prompt that exercises the tools end to
end, and the text survives the template's whitespace collapse because it is
kept as a string in the script block rather than as slot text.

### The footer

Three links, separated by a middot: the licence, the version and the
repository. Each is underlined on hover and on focus, with the underline
colour moving from 32 percent white to 85 percent.

### The OAuth form

An input 640 pixels wide at the most, with a 1 pixel border, an 8 pixel
padding and a 16 pixel font, and a button in the badge blue with a 4 pixel
radius and a 19 pixel horizontal padding. Under the pointer the button
darkens. A code block below carries the token.

## Do's and Don'ts

### Do:

- **Do** keep the gradient as the one documented exception to the token
  rule, with the contrast note beside it.
- **Do** put the opacity on the text rather than on a colour, so the
  platform's tokens stay intact.
- **Do** keep the OAuth stylesheet self-contained and under a kilobyte.
- **Do** underline a link on hover and on focus, and keep the focus ring.
- **Do** name the colour of every exception in a comment where the exception
  lives.

### Don't:

- **Don't** add a web font. The OAuth policy has no `font-src` carve-out.
- **Don't** put a literal colour outside `assets/css/main.css` and the
  stylesheet in `server/utils/oauth-html.ts`.
- **Don't** move body content into the band of the gradient where the
  contrast was measured.
- **Don't** draw a component the platform already has.
- **Don't** add a picture of the tools. The page has one job and the
  prompt is the thing on it.
