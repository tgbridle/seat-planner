# Seat Planner

A web app to help couples plan their wedding seating. To be possibly extended to other table planning use cases in the future.

**Live site:** https://tgbridle.github.io/seat-planner
**The planner:** https://tgbridle.github.io/seat-planner/app.html

## Who it's for

Brides and grooms planning their wedding who want an easy way to arrange guests at tables. Future maybe other personas.

## What it does

- Lay out tables on a floor plan: drag them around, change shape and number of seats (type a number, or press + and -), split them.
- Zoom and pan the floor: pinch on a trackpad or touch screen, Ctrl + mouse wheel, or drag empty floor.
- Add guests, drag them between tables or onto the unseated guest list, and reorder them in the guest list.
- Import a guest list from Excel, CSV or Numbers. It finds name, table, party and RSVP columns, and can seat everyone automatically.
- Set the venue capacity and see how many places are left.
- Keep several events. They save automatically, with undo and redo.
- Share a view-only link to a plan.

## Current limits

- **Accounts:** there's one built-in test user. Events are saved in the browser on that device, so they don't follow you to another computer.
- **Sharing:** a share link holds a snapshot of the plan inside the link itself. Later changes need a new link. Inviting editors needs online accounts and is marked "coming soon".
- **Dragging guests** uses the browser's drag and drop, which doesn't work on phones and tablets. There you can move a guest by tapping them and choosing a table.

## How it's built

Plain HTML, CSS and JavaScript, with no framework and no build step.

| File | What it does |
| --- | --- |
| `index.html` | Landing page |
| `app.html` | The planner page (structure only) |
| `css/app.css` | All the planner's styles |
| `js/util.js` | Small helpers: building elements, icons, menus, dialogs, messages |
| `js/model.js` | What a seating plan is, and basic changes to it |
| `js/geometry.js` | Table sizes, seat positions, finding space for new tables |
| `js/storage.js` | Saving and loading events (the only file that would change for online accounts) |
| `js/store.js` | The open event, undo/redo, and every action you can take |
| `js/viewport.js` | Zooming and panning the floor |
| `js/render.js` | Drawing the tables and the guest list |
| `js/interactions.js` | Dragging tables and guests, renaming, the guest card |
| `js/events-ui.js` | Switching events, the account menu, the "Saved" indicator |
| `js/import.js` | Importing a guest list from a spreadsheet |
| `js/share.js` | Share links and the view-only mode |
| `js/main.js` | Starts the app and connects everything |

The scripts load in that order, and each file uses what the files above it define. The spreadsheet reader ([SheetJS](https://sheetjs.com)) is only downloaded when someone imports a file.

## Run it locally

Double-click `app.html` to open it in your browser. Importing a spreadsheet needs an internet connection.
