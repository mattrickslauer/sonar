#!/usr/bin/env python3
"""Generate ARCHITECTURE_DIAGRAM.pdf — one idea per page, visual-first.

Each page is a single inline SVG (dark radar aesthetic, channel palette) wrapped
in an HTML page and rendered to PDF with WeasyPrint. Run:

    python3 docs/architecture/generate_pdf.py
"""
import math
import os

# ----------------------------------------------------------------------------- palette
BG      = "#0a0f1c"
PANEL   = "#141c30"
PANEL2  = "#1b2540"
STROKE  = "#2c3a5c"
TEXT    = "#eaf0fb"
MUTED   = "#94a3c4"
FAINT   = "#5a6788"
CYAN    = "#22d3ee"   # social / radar
AMBER   = "#f5a524"   # events / dynamodb
ROSE    = "#fb7185"   # food
VIOLET  = "#a855f7"   # music
RED     = "#ef4444"   # safety
GREEN   = "#34d399"   # permanent / dsql
BLUE    = "#3b82f6"
FONT    = "DejaVu Sans, Helvetica, Arial, sans-serif"

W, H = 1280, 720


# ----------------------------------------------------------------------------- svg helpers
def esc(s):
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def text(x, y, s, size, color, anchor="start", weight="400", spacing=None, opacity=1, family=FONT):
    ls = f' letter-spacing="{spacing}"' if spacing else ""
    return (f'<text x="{x:.1f}" y="{y:.1f}" font-family="{family}" font-size="{size}" '
            f'fill="{color}" text-anchor="{anchor}" font-weight="{weight}"{ls} '
            f'opacity="{opacity}">{esc(s)}</text>')


def rect(x, y, w, h, fill, stroke=None, rx=0, sw=1.5, opacity=1, dash=None):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<rect x="{x:.1f}" y="{y:.1f}" width="{w:.1f}" height="{h:.1f}" rx="{rx}" '
            f'fill="{fill}"{s}{d} opacity="{opacity}"/>')


def circle(cx, cy, r, fill="none", stroke=None, sw=1.5, opacity=1, dash=None):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if stroke else ""
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return f'<circle cx="{cx:.1f}" cy="{cy:.1f}" r="{r:.1f}" fill="{fill}"{s}{d} opacity="{opacity}"/>'


def line(x1, y1, x2, y2, color=MUTED, sw=2, dash=None, opacity=1):
    d = f' stroke-dasharray="{dash}"' if dash else ""
    return (f'<line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}" '
            f'stroke="{color}" stroke-width="{sw}"{d} opacity="{opacity}" stroke-linecap="round"/>')


def arrow(x1, y1, x2, y2, color=MUTED, sw=2.2, dash=None, head=9, label=None, label_color=None, label_dy=-9):
    a = math.atan2(y2 - y1, x2 - x1)
    # pull the line back so it meets the base of the head
    bx, by = x2 - head * math.cos(a), y2 - head * math.sin(a)
    p2 = (x2 - head * math.cos(a - 0.42), y2 - head * math.sin(a - 0.42))
    p3 = (x2 - head * math.cos(a + 0.42), y2 - head * math.sin(a + 0.42))
    out = [line(x1, y1, bx, by, color, sw, dash),
           f'<polygon points="{x2:.1f},{y2:.1f} {p2[0]:.1f},{p2[1]:.1f} {p3[0]:.1f},{p3[1]:.1f}" fill="{color}"/>']
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2 + label_dy
        out.append(text(mx, my, label, 12, label_color or MUTED, "middle", "600"))
    return "".join(out)


def box(x, y, w, h, title, subs=None, accent=CYAN, fill=PANEL, rx=16, title_size=21, sub_size=13, tag=None):
    parts = [rect(x, y, w, h, fill, STROKE, rx),
             f'<rect x="{x:.1f}" y="{y+11:.1f}" width="5" height="{h-22:.1f}" rx="2.5" fill="{accent}"/>']
    cx = x + w / 2 + 2
    if subs:
        parts.append(text(cx, y + 38, title, title_size, TEXT, "middle", "700"))
        ty = y + 60
        for i, s in enumerate(subs):
            parts.append(text(cx, ty + i * 19, s, sub_size, MUTED, "middle"))
    else:
        parts.append(text(cx, y + h / 2 + title_size * 0.34, title, title_size, TEXT, "middle", "700"))
    if tag:
        parts.append(text(x + w - 14, y + 22, tag, 10.5, accent, "end", "700", spacing=1.6))
    return "".join(parts)


def chip(x, y, w, h, title, sub, accent):
    return ("".join([
        rect(x, y, w, h, PANEL2, STROKE, 11),
        f'<rect x="{x:.1f}" y="{y:.1f}" width="5" height="{h:.1f}" rx="2.5" fill="{accent}"/>',
        text(x + 16, y + 25, title, 15, TEXT, "start", "700"),
        text(x + 16, y + 45, sub, 11.5, MUTED, "start", family=FONT),
    ]))


def radar_motif(cx, cy, r, color=CYAN):
    """Faint concentric rings + a sweep wedge, as a background flourish."""
    out = [circle(cx, cy, r * f, stroke=color, sw=1, opacity=0.07) for f in (1, 0.72, 0.46, 0.22)]
    out.append(line(cx, cy, cx + r, cy, color, 1, opacity=0.06))
    out.append(line(cx, cy, cx, cy - r, color, 1, opacity=0.06))
    # sweep wedge
    a0, a1 = -1.15, -0.55
    out.append(f'<path d="M {cx} {cy} L {cx + r*math.cos(a0):.1f} {cy + r*math.sin(a0):.1f} '
               f'A {r} {r} 0 0 1 {cx + r*math.cos(a1):.1f} {cy + r*math.sin(a1):.1f} Z" '
               f'fill="{color}" opacity="0.05"/>')
    return "".join(out)


def page(kicker, title, caption, body, n, total=5):
    head = [
        rect(0, 0, W, H, BG),
        radar_motif(W - 150, 150, 240),
        text(70, 50, kicker, 13, CYAN, "start", "700", spacing=3),
        text(68, 92, title, 35, TEXT, "start", "800"),
        line(70, 108, 250, 108, CYAN, 3),
    ]
    cap = caption if isinstance(caption, list) else [caption]
    foot = [text(70, H - 52 + i * 21, c, 15, MUTED, "start") for i, c in enumerate(cap)]
    foot.append(text(W - 70, H - 36, f"{n:02d} / {total:02d}", 12, FAINT, "end", "700", spacing=1))
    foot.append(text(70, H - 36 + (len(cap) - 1) * 21 + 6, "SONAR · the layer where places remember",
                     11, FAINT, "start", spacing=1.5) if False else "")
    svg = (f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">'
           + "".join(head) + body + "".join(foot) + "</svg>")
    return f'<div class="page">{svg}</div>'


# ----------------------------------------------------------------------------- page 1: overview
def p1():
    b = []
    # client
    b.append(box(60, 300, 190, 96, "Client", ["radar · drop", "love · heartbeat"], CYAN))
    # dynamodb
    b.append(box(330, 268, 300, 160, "DynamoDB · sonar",
                 ["one ephemeral table", "24h TTL · geohash PK", "Streams on every write"],
                 AMBER, tag="LIVE PATH"))
    # consumers
    cy0 = 250
    b.append(box(720, 250, 280, 68, "Live fan-out", ["new drop → subscribers (WS)"],
                 CYAN, PANEL2, title_size=17, sub_size=11.5))
    b.append(box(720, 332, 280, 68, "Promote", ["loved → DSQL archive"],
                 GREEN, PANEL2, title_size=17, sub_size=11.5))
    b.append(box(720, 414, 280, 68, "Meter", ["usage → billing"],
                 ROSE, PANEL2, title_size=17, sub_size=11.5))
    # dsql
    b.append(box(1040, 300, 175, 160, "Aurora DSQL",
                 ["greatest hits", "analytics", "billing"], GREEN, tag="FOREVER"))
    # arrows
    b.append(arrow(250, 348, 330, 348, MUTED, label="REST", label_dy=-10))
    b.append(arrow(630, 320, 720, 283, FAINT, label="Streams", label_dy=-7))
    b.append(arrow(630, 348, 720, 365, FAINT))
    b.append(arrow(630, 376, 720, 447, FAINT))
    b.append(arrow(1000, 365, 1040, 372, GREEN))
    b.append(arrow(1000, 447, 1040, 408, GREEN))
    # bot loop
    b.append(box(330, 470, 140, 70, "EventBridge", ["~1 min tick"], VIOLET, PANEL2, title_size=15, sub_size=11))
    b.append(box(490, 470, 140, 70, "Bots", ["templated drops"], VIOLET, PANEL2, title_size=15, sub_size=11))
    b.append(arrow(470, 505, 490, 505, VIOLET))
    b.append(arrow(560, 470, 520, 428, VIOLET, dash="4 4"))
    b.append(text(480, 568, "PRESENCE heartbeat tells bots which cells have real users", 12, FAINT, "middle"))
    return page("ARCHITECTURE", "How Sonar's data layer works",
                "One ephemeral table keeps the live radar fast; Streams turn the crowd's love into permanence.",
                "".join(b), 1)


# ----------------------------------------------------------------------------- page 2: geo query
def p2():
    b = []
    gx, gy, cell = 430, 175, 125          # 3x3 grid origin
    cxc, cyc = gx + 1.5 * cell, gy + 1.5 * cell
    # neighbor cells
    for r in range(3):
        for c in range(3):
            x, y = gx + c * cell, gy + r * cell
            center = (r == 1 and c == 1)
            b.append(rect(x, y, cell, cell, PANEL if center else BG,
                          CYAN if center else STROKE, 6, sw=2 if center else 1.2,
                          opacity=1 if center else 0.9))
    # radius circle (radar range)
    b.append(circle(cxc, cyc, cell * 1.32, stroke=CYAN, sw=1.8, dash="6 6", opacity=0.6))
    b.append(text(gx + 0.5 * cell, gy + 18, "neighbor", 11, FAINT, "middle"))
    b.append(text(cxc, cyc - cell * 0.34, "your cell · gh6", 13, CYAN, "middle", "700"))
    # user pin
    b.append(circle(cxc, cyc, 7, CYAN))
    b.append(circle(cxc, cyc, 13, stroke=CYAN, sw=1.5, opacity=0.7))
    # scattered drops, colored by channel, brightness ~ proximity
    drops = [(-0.55, -0.35, AMBER, 1.0), (0.7, -0.6, VIOLET, 0.5), (0.35, 0.5, ROSE, 0.85),
             (-0.8, 0.7, GREEN, 0.4), (0.95, 0.25, CYAN, 0.45), (-0.2, 0.9, AMBER, 0.7),
             (0.15, -0.85, ROSE, 0.55)]
    for dx, dy, col, near in drops:
        px, py = cxc + dx * cell * 1.25, cyc + dy * cell * 1.25
        b.append(circle(px, py, 6 + 4 * near, col, opacity=0.35 + 0.65 * near))
    # proximity legend
    lx, ly = 905, 540
    b.append(text(lx, ly - 16, "COLOR = DISTANCE", 11, MUTED, "start", "700", spacing=1.5))
    for i in range(20):
        t = i / 19
        b.append(rect(lx + i * 9, ly, 9, 16, CYAN, opacity=0.2 + 0.8 * t))
    b.append(text(lx, ly + 34, "far", 11, FAINT, "start"))
    b.append(text(lx + 180, ly + 34, "near", 11, CYAN, "end", "700"))
    # note card
    b.append(chip(120, 250, 250, 70, "1 query × 9 cells", "your cell + 8 neighbors, per channel", CYAN))
    b.append(chip(120, 340, 250, 70, "merge & rank", "proximity + freshness, client-side", AMBER))
    b.append(chip(120, 430, 250, 70, "exact distance", "haversine in the browser → color", GREEN))
    return page("GEO QUERY", "What's near me",
                "The world is a grid of geohash cells. Query your cell plus its 8 neighbors, then color each drop by real distance.",
                "".join(b), 2)


# ----------------------------------------------------------------------------- page 3: single table
def p3():
    b = []
    # central table cylinder
    cx, cy = 640, 330
    b.append(rect(cx - 95, cy - 70, 190, 140, PANEL, AMBER, 18, sw=2))
    b.append(text(cx, cy - 18, "sonar", 26, TEXT, "middle", "800"))
    b.append(text(cx, cy + 10, "one table", 13, MUTED, "middle"))
    b.append(text(cx, cy + 34, "PK + SK", 13, AMBER, "middle", "700"))
    items = [
        ("Waypoint",   "CH#chan#GEO#gh6 / WP#ulid", AMBER,  300, 150),
        ("Love edge",  "WP#id / LOVE#user",         ROSE,   720, 150),
        ("Presence",   "PRESENCE / GEO#gh6#USER",   CYAN,   300, 250),
        ("Connection", "CONN#chan / CID#id",        VIOLET, 720, 250),
        ("Membership", "CH#chan / MEMBER#user",     GREEN,  300, 488),
        ("Usage",      "USAGE#chan#hr / EVT#ulid",  RED,    720, 488),
    ]
    for title, key, col, x, y in items:
        b.append(chip(x, y, 260, 64, title, key, col))
        # connector to center
        sx = x + 260 if x < cx else x
        b.append(line(sx, y + 32, cx + (-95 if x < cx else 95), cy, col, 1.4, dash="3 4", opacity=0.5))
    # GSI note (centered in the gap above the bottom row)
    b.append(chip(505, 404, 270, 54, "GSI1 — reverse lookups", "my drops · channels I'm in", BLUE))
    return page("SINGLE TABLE", "One table, many shapes",
                "DynamoDB holds six item types under one key schema — the key prefix IS the type. Access patterns drive the design, not entities.",
                "".join(b), 3)


# ----------------------------------------------------------------------------- page 4: reactive bots
def p4():
    b = []
    # flow across the top
    b.append(box(70, 180, 180, 84, "User arrives", ["writes PRESENCE"], CYAN, title_size=18))
    b.append(box(310, 180, 180, 84, "EventBridge", ["~1 min tick"], VIOLET, title_size=18))
    b.append(box(550, 180, 180, 84, "Density check", ["cell too quiet?"], AMBER, title_size=17))
    b.append(arrow(250, 222, 310, 222, MUTED))
    b.append(arrow(490, 222, 550, 222, MUTED))
    # before / after cells
    bx, ax = 250, 760
    for label, x, dots in (("QUIET CELL", bx, [(0.1, -0.1, CYAN, "you")]),
                           ("SEEDED CELL", ax,
                            [(0.1, -0.1, CYAN, "you"), (-0.5, -0.4, AMBER, ""), (0.5, -0.5, VIOLET, ""),
                             (-0.4, 0.5, ROSE, ""), (0.55, 0.45, GREEN, ""), (-0.05, 0.65, AMBER, ""),
                             (0.65, 0.05, ROSE, "")])):
        cxx, cyy, rr = x, 446, 110
        b.append(rect(cxx - rr, cyy - rr, rr * 2, rr * 2, PANEL, STROKE, 14))
        b.append(text(cxx, cyy - rr - 14, label, 12, MUTED, "middle", "700", spacing=1.5))
        b.append(circle(cxx, cyy, rr * 0.92, stroke=CYAN, sw=1, dash="5 6", opacity=0.4))
        for dx, dy, col, tag in dots:
            px, py = cxx + dx * rr, cyy + dy * rr
            real = (tag == "you")
            b.append(circle(px, py, 9 if real else 7, col, opacity=1 if real else 0.85))
            if real:
                b.append(circle(px, py, 15, stroke=col, sw=1.3, opacity=0.6))
    b.append(arrow(bx + 135, 446, ax - 135, 446, VIOLET, sw=2.6,
                   label="bots top up to liveness target", label_color=VIOLET, label_dy=-14))
    b.append(chip(425, 584, 440, 60, "tagged actorType=bot",
                  "24h TTL cleans them up · never billed, never promoted", VIOLET))
    return page("LIVENESS", "Bots seed the place reactively",
                "No pre-seeded world. When a real user shows up to a quiet cell, bots fill it so the radar is never empty.",
                "".join(b), 4)


# ----------------------------------------------------------------------------- page 5: earned permanence
def p5():
    b = []
    # ephemeral card (left)
    b.append(rect(110, 220, 300, 230, PANEL, STROKE, 16))
    b.append(text(130, 256, "EPHEMERAL DROP", 12, MUTED, "start", "700", spacing=1.5))
    b.append(text(130, 292, '"birria truck, gate C —', 16, TEXT, "start"))
    b.append(text(130, 314, ' line is short rn"', 16, TEXT, "start"))
    # ttl clock
    b.append(circle(180, 380, 30, stroke=ROSE, sw=3, opacity=0.8))
    b.append(line(180, 380, 180, 360, ROSE, 3))
    b.append(line(180, 380, 195, 388, ROSE, 3))
    b.append(text(228, 376, "24h TTL", 15, ROSE, "start", "700"))
    b.append(text(228, 398, "auto-expires", 12, MUTED, "start"))
    # love meter
    mx, my, mw = 470, 300, 250
    b.append(text(mx, my - 14, "REALLOVE  (human only)", 12, MUTED, "start", "700", spacing=1.2))
    b.append(rect(mx, my, mw, 22, PANEL2, STROKE, 11))
    b.append(rect(mx, my, mw * 0.82, 22, GREEN, rx=11, opacity=0.85))
    b.append(line(mx + mw * 0.78, my - 8, mx + mw * 0.78, my + 30, TEXT, 2, dash="3 3"))
    b.append(text(mx + mw * 0.78, my - 14, "40", 12, TEXT, "middle", "700"))
    b.append(text(mx, my + 48, "bot love never counts toward the threshold", 12, FAINT, "start"))
    # arrow to permanent
    b.append(arrow(740, 300, 860, 300, GREEN, sw=2.6, label="Streams: realLove ≥ 40", label_color=GREEN, label_dy=-13))
    # permanent card (right)
    b.append(rect(870, 220, 320, 230, PANEL, GREEN, 16, sw=2))
    b.append(text(890, 256, "GREATEST HITS · DSQL", 12, GREEN, "start", "700", spacing=1.2))
    b.append(text(890, 296, '"birria truck, gate C"', 16, TEXT, "start"))
    b.append(circle(905, 345, 9, GREEN))
    b.append(text(925, 350, "promoted — kept forever", 13, MUTED, "start"))
    b.append(text(890, 400, "browsable at this spot", 13, MUTED, "start"))
    b.append(text(890, 422, "and on home", 13, MUTED, "start"))
    # fading expired copies under the left card
    for i in range(4):
        b.append(rect(120 + i * 14, 470, 240, 18, FAINT, rx=6, opacity=0.28 - i * 0.06))
    b.append(text(130, 512, "everything else fades at 24h", 12, FAINT, "start"))
    return page("EARNED PERMANENCE", "Love turns ephemeral into forever",
                "Every drop expires in 24h — unless the crowd loves it past the threshold. Then a Stream copies it to the permanent archive.",
                "".join(b), 5)


# ----------------------------------------------------------------------------- render
HTML = """<!doctype html><html><head><meta charset="utf-8"><style>
@page {{ size: {w}px {h}px; margin: 0; }}
* {{ margin: 0; padding: 0; }}
.page {{ width: {w}px; height: {h}px; overflow: hidden; }}
.page:not(:last-child) {{ page-break-after: always; }}
svg {{ display: block; }}
</style></head><body>{pages}</body></html>"""


def main():
    pages = "".join([p1(), p2(), p3(), p4(), p5()])
    html = HTML.format(w=W, h=H, pages=pages)
    here = os.path.dirname(os.path.abspath(__file__))
    root = os.path.abspath(os.path.join(here, "..", ".."))
    debug = os.path.join(here, "_diagram.html")
    with open(debug, "w") as f:
        f.write(html)
    from weasyprint import HTML as WP
    out = os.path.join(root, "ARCHITECTURE_DIAGRAM.pdf")
    WP(string=html).write_pdf(out)
    print("wrote", out)


if __name__ == "__main__":
    main()
