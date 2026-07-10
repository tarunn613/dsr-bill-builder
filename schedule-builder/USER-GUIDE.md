# DSR Bill Builder — User Guide

A simple guide for preparing a **Schedule of Work** and an **RA Bill** from the
DSR rate database. No technical knowledge needed.

---

## 1. Installing the app

You only do this once.

### On Windows
1. Copy the file **`DSR-Bill-Builder-Setup-1.0.0.exe`** to your computer.
2. Double-click it.
3. If Windows shows a blue "Windows protected your PC" box, click **More info → Run anyway**
   (this appears because the app is used inside your office, not downloaded from a store).
4. Follow the installer (you can keep all the default options). It puts a
   **DSR Bill Builder** icon on your Desktop and in the Start menu.
5. Double-click the **DSR Bill Builder** icon to open it.

### On Mac
1. Copy **`DSR-Bill-Builder-1.0.0.dmg`** to your computer and double-click it.
2. Drag the **DSR Bill Builder** icon into the **Applications** folder.
3. The first time only: right-click the app → **Open** → **Open** (this is needed once
   because the app is for internal office use).
4. After that, open it normally from Applications or Launchpad.

There is **nothing else to install** — no internet, no separate downloads. Everything
works offline on your computer.

---

## 2. How your work is saved — Sessions

Every tender you work on is called a **Session**. The app **saves everything
automatically, all the time** — you never have to click "Save". If you close the
app or the computer restarts, your work is exactly where you left it.

Each session remembers:
- the Schedule of Work (all your items, rates and quantities),
- the RA Bill (measurements, abstract, quoted rate),
- **copies of every Excel/PDF you exported**, and every file you imported.

### The **Sessions** page (top menu)
- **+ New session** — start a new tender. Give it a clear name, e.g.
  *"Reboring tubewell Ward-12"* or *"Ward-5 road, 1st RA Bill"*.
- **Open** — switch to a different tender. The whole app instantly shows that
  tender's work.
- **Rename** — change a tender's name any time.
- **Export** — save the whole tender as a single file (ends in **`.dbill`**).
  Use this to **back it up**, move it to another computer, or hand it to a
  colleague.
- **Import session** — open a `.dbill` file someone gave you (it comes in as a
  new tender; it never overwrites your existing ones).
- **Delete** — permanently remove a tender. (Careful — this cannot be undone.)

The active tender's name always shows at the **top-right** with a green dot.

The **Files** box on the Sessions page lists every Excel/PDF you have exported for
that tender, with a **Download** button to get any of them again later.

---

## 3. Making a Schedule of Work  (menu: **DSR → Schedule**)

1. Fill in the project details (name of work, sub-head, etc.).
2. Set **No. of DSR items** and **No. of market items**, then click **Create rows**.
3. For each DSR item, type the **DSR code** (or a keyword) and pick it — the
   description, unit and rate fill in automatically from the database.
4. Enter the **quantity** for each item.
5. Set the **Multiplying factor** and **Cost Index %** for your tender.
6. Watch the **Grand Total** and **Say** update live on the right.
7. Click **Export Excel** or **Export PDF** to save the schedule. (A copy is also
   kept in your session automatically.)
8. Click **Send to Bill →** to carry these items into the RA Bill.

> If a DSR rate legitimately differs from the book for your tender, you can
> **override** a single rate. The book rate is always shown next to it, and the
> override is clearly flagged in the exported file — the database itself is never
> changed.

---

## 4. Making the RA Bill  (menu: **Schedule → Bill**)

The bill has three linked sheets. Change one and the others update automatically.

1. **Schedule tab** — the list of items and rates (arrives from the schedule page,
   or upload an Excel schedule with **Upload schedule**).
2. **RE — Measurements tab** — enter your measurements for each item
   (Nos × Length × Width × Height, with a factor). A **negative "Nos"** makes a
   *"less"* deduction row. The quantity totals up automatically.
3. **Abstract tab** — quantities (from your measurements) × rates (from the
   schedule) = amounts, with the full tender calculation and the **quoted rate %**
   (e.g. *18.50% below*) applied to give the **Gross Amount Payable**.
4. Click **⬇ Export Bill (.xlsx)** to get the final workbook. It contains the
   Schedule, Record of Measurements and Abstract, all cross-linked with live
   formulas, so the exported Excel stays "dynamic" too.

---

## 5. Where is my data kept?

Everything is stored **on your own computer only** — nothing goes to the internet.
The exact folder is shown at the bottom of the **Sessions** page. To back up all
your tenders at once, either copy that folder, or use **Export** on each tender to
save `.dbill` files somewhere safe (e.g. a pen-drive).

---

## 6. Common questions

**I closed the app without saving — did I lose my work?**
No. The app saves automatically. Reopen it and your tender is exactly as you left it.

**How do I move a tender to another computer?**
On the first computer: Sessions → **Export** (you get a `.dbill` file). On the second
computer: Sessions → **Import session** → pick that file.

**Can two people work on the same tender?**
Not at the same time. But you can hand a tender over as a `.dbill` file, and the
other person imports it.

**I need an old Excel I exported last week.**
Sessions page → open that tender → the **Files** box lists every export with a
**Download** button.
