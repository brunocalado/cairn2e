/*!
 * Cairn 2e for Foundry VTT — https://github.com/brunocalado/cairn2e
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License version 3.
 */

import { SYSTEM_ID, SETTINGS } from "../constants.js";
import {
  blankStore, withItem, withItems, withoutItem, withSettings, folderTree, sellable, sellPrice, buyPrice,
  sellableOwn, cartSummary, untitledName
} from "../store-rules.js";
import { BELONGINGS } from "../coin-rules.js";
import { copyOf } from "../helpers.js";
import { chooseGainPlace, applyGold } from "../coin.js";
import { scheduleInk } from "../ink.js";
import { CairnInkMixin } from "./_ink-mixin.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

const TEMPLATES = `systems/${SYSTEM_ID}/templates/apps/store`;
const CARD_TPL = `systems/${SYSTEM_ID}/templates/chat/store-card.hbs`;
const SETTINGS_TPL = `${TEMPLATES}/settings.hbs`;

/**
 * The `type` a row dragged inside this window carries. Not `"Item"`: an `Item` payload dropped
 * on a character sheet creates the item, and a shelf is not a free sample. Core's sheets ignore
 * a type they do not know, so a shelf row dragged anywhere but the cart does nothing.
 */
const STORE_DRAG = `${SYSTEM_ID}.store`;

/**
 * The store window — one per client, drawn from `SETTINGS.STORES` and the cart this player has
 * filled.
 *
 * One window for both roles. The Warden sees the shelves with the editing affordances: a store
 * to pick, New / Open to players / Settings / Delete on the one line above them, a drop target
 * for Items from a compendium or the directory, and a × per row. Every edit writes the setting
 * at once — there is no Save
 * button and no draft, the way every press in the journey window writes `SETTINGS.JOURNEY` —
 * and the setting's `onChange` (`module/settings.js`) calls {@link CairnStore.refresh} on every
 * client, so a Warden's edit lands on a player's open window a moment later.
 *
 * A player sees two columns. Left, the shelves and — on a second tab — their own priced things
 * by where they sit; right, the cart: what they are buying, by quantity, and what they are
 * selling at the Warden's ratio. The foot adds it up in gold and, what matters more in Cairn, in
 * slots, and Confirm is held back with the reason while the coin is short or the things would
 * not fit. The cart is this window's alone — never written anywhere, gone when the window closes.
 *
 * A store is a list of uuids; the price on a row is the referenced Item's `cost` at the moment
 * the window draws, so "to change the price, edit the item" holds.
 *
 * Opening it: the sidebar tab (Warden), or the Warden's "Open to players", which is a socket
 * broadcast carrying the store's id that every client answers by opening its own window
 * (`module/cairn2e.js`). There is no player-side entry point, and a player with no linked
 * character gets a notice rather than a window: with no purse there is nothing to show.
 */
export class CairnStore extends CairnInkMixin(HandlebarsApplicationMixin(ApplicationV2)) {
  /** @override — the ink layer is one canvas over `.window-content`, and the panes that scroll
   *  are the shelf and the cart, not the tabs: a scrolled list moved its rows and left their
   *  hairlines where they were. */
  static INK_SCROLLERS = [".cairn-store-list", ".cairn-store-cart-lines"];

  static DEFAULT_OPTIONS = {
    id: "cairn2e-store",
    classes: [SYSTEM_ID, "cairn-store"],
    position: { width: 760, height: 640 },
    window: { title: "CAIRN.Store.Title", icon: "fas fa-store", resizable: true },
    actions: {
      storeNew: CairnStore.#onStoreNew,
      storeSettings: CairnStore.#onStoreSettings,
      storeDelete: CairnStore.#onStoreDelete,
      storeRemove: CairnStore.#onStoreRemove,
      storeOpenAll: CairnStore.#onStoreOpenAll,
      openItem: CairnStore.#onOpenItem,
      cartAdd: CairnStore.#onCartAdd,
      cartSell: CairnStore.#onCartSell,
      cartRemove: CairnStore.#onCartRemove,
      checkout: CairnStore.#onCheckout
    }
  };

  // Six parts: the head; the rail over the two left-hand tabs, the shelves and the player's own
  // things; the cart; the foot. Neither role draws all six — the Warden has no rail, no own
  // things, no cart and no foot, and a shopper has no head (`_configureRenderParts`). Each list
  // is its own scroller so the foot stays put.
  static PARTS = {
    header: { template: `${TEMPLATES}/header.hbs` },
    nav: { template: `systems/${SYSTEM_ID}/templates/parts/sheet-nav.hbs` },
    catalog: { template: `${TEMPLATES}/catalog.hbs`, scrollable: [".cairn-store-list"] },
    yours: { template: `${TEMPLATES}/yours.hbs`, scrollable: [".cairn-store-list"] },
    cart: { template: `${TEMPLATES}/cart.hbs`, scrollable: [".cairn-store-cart-lines"] },
    footer: { template: `${TEMPLATES}/footer.hbs` }
  };

  // Named `primary` so the shared rail partial draws it as it draws every other rail.
  static TABS = {
    primary: {
      initial: "catalog",
      tabs: [
        { id: "catalog", label: "CAIRN.Store.Tab.Store" },
        { id: "yours", label: "CAIRN.Store.Tab.Yours" }
      ]
    }
  };

  /** The one window this client has. */
  static #instance = null;

  /** The store on screen. The Warden changes it with the head's `<select>`; a player's is fixed
   *  by the broadcast that opened the window. */
  #storeId = null;

  /** What this player has put in the cart — `buy` by uuid to a quantity, `sell` the ids of their
   *  own items. Never persisted: reset when the store changes and when the window closes. */
  #cart = { buy: new Map(), sell: new Set() };

  /** The drag and drop, built once and re-bound on every render. */
  #dd = null;

  /**
   * Open the window on a store, or bring the open one forward. With no id the Warden gets the
   * store already on screen, or the first one saved.
   */
  static open(storeId) {
    if (!game.user.isGM && !game.user.character) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Store.NoCharacter"));
      return null;
    }
    const app = CairnStore.#instance ??= new CairnStore();
    if (storeId && storeId !== app.#storeId) {
      app.#storeId = storeId;
      app.#cart = { buy: new Map(), sell: new Set() };
    }
    return app.render({ force: true });
  }

  /** Redraw the open window from the setting. A closed one is left closed. */
  static refresh() {
    const app = CairnStore.#instance;
    if (app?.rendered) app.render();
  }

  /** @override */
  get title() {
    const name = this.#store?.name;
    return name ? `${game.i18n.localize("CAIRN.Store.Title")} — ${name}` : game.i18n.localize("CAIRN.Store.Title");
  }

  /** Every saved store, by id. */
  get #stores() {
    return game.settings.get(SYSTEM_ID, SETTINGS.STORES) ?? {};
  }

  /** The store on screen, or null when there is none — the Warden's first open, or a store deleted
   *  under a player's window. */
  get #store() {
    return this.#stores[this.#storeId] ?? null;
  }

  /** Write one store back into the setting. The setting's `onChange` is what redraws. */
  async #save(store) {
    await game.settings.set(SYSTEM_ID, SETTINGS.STORES, { ...this.#stores, [this.#storeId]: store });
  }

  /** @override */
  _configureRenderOptions(options) {
    super._configureRenderOptions(options);
    // The Warden with no store chosen lands on the first one saved, so the window never opens on
    // an empty shelf while there is a full one a click away.
    if (game.user.isGM && !this.#store) this.#storeId = Object.keys(this.#stores)[0] ?? null;
    // Core writes the frame's title on the first render only; the store's name is part of it
    // here, so every render says it again.
    if (this.hasFrame) {
      options.window ??= {};
      options.window.title = this.title;
    }
  }

  /** @override — the Warden builds; only a shopper has a rail, own things and a cart. */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    if (game.user.isGM) {
      delete parts.nav;
      delete parts.yours;
      delete parts.cart;
      // The foot is the till, and the Warden buys nothing. Their one command — put this store on
      // every screen — is a glyph up in the head beside the two that act on the same store.
      delete parts.footer;
    } else {
      // A shopper has no head: their own name is not news and their gold is the foot's first
      // figure. An empty band would still cost the grid a row and the gap under it.
      delete parts.header;
    }
    return parts;
  }

  /** @override — the Warden's one tab is the shelves, drawn active with no rail to pick it from. */
  _getTabsConfig(group) {
    const config = super._getTabsConfig(group);
    if (!config || !game.user.isGM) return config;
    return { ...config, tabs: config.tabs.filter((t) => t.id === "catalog") };
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const isGM = game.user.isGM;
    const stores = this.#stores;
    const store = this.#store;

    context.isGM = isGM;
    context.stores = Object.entries(stores).map(([id, s]) => ({ id, name: s.name, selected: id === this.#storeId }));
    context.store = store && { id: this.#storeId, name: store.name };
    // Both rates belong to the store, set in its own settings dialog.
    const buyRatio = store?.buyRatio ?? 100;
    // A uuid that no longer resolves is dropped from the drawing, never from the setting: the
    // Warden sees the row is gone and decides what to do about it.
    const resolved = store ? await Promise.all(store.items.map((uuid) => fromUuid(uuid))) : [];
    const items = resolved.filter((item) => item);
    context.rows = items.map((item) => ({
      uuid: item.uuid,
      img: item.img,
      name: item.name,
      system: item.system,
      cost: buyPrice(item.system.cost, buyRatio),
      inCart: this.#cart.buy.get(item.uuid) ?? 0
    }));
    if (isGM) return context;

    // The shopper's side. The cart is reconciled against what is on the shelves and on the
    // character NOW: a row the Warden took off, or an item the player dropped from the sheet,
    // leaves the cart on its own.
    const actor = game.user.character;
    const ratio = store.sellRatio;
    const byUuid = new Map(items.map((item) => [item.uuid, item]));
    for (const uuid of [...this.#cart.buy.keys()]) if (!byUuid.has(uuid)) this.#cart.buy.delete(uuid);
    for (const id of [...this.#cart.sell]) if (!actor.items.get(id)) this.#cart.sell.delete(id);

    context.character = { name: actor.name, gold: actor.system.gold };
    context.yours = sellableOwn(actor.items.contents).map((group) => ({
      label: group.place === "" ? game.i18n.localize("CAIRN.Store.OnYou")
        : group.place === BELONGINGS ? game.i18n.localize("CAIRN.Belongings")
          : actor.items.get(group.place)?.name ?? "",
      rows: group.items.map((item) => ({
        id: item.id,
        img: item.img,
        name: item.name,
        system: item.system,
        price: sellPrice(item.system.cost, ratio),
        inCart: this.#cart.sell.has(item.id)
      }))
    }));
    const buy = [...this.#cart.buy].map(([uuid, qty]) => ({ doc: byUuid.get(uuid), qty }));
    const sell = [...this.#cart.sell].map((id) => actor.items.get(id));
    // One line is one unit. A counter on a line is a second place for a number the list itself
    // already says, and three Rations read as three things to carry — which is what they are.
    const buyLines = [];
    for (const { doc, qty } of buy) {
      const price = buyPrice(doc.system.cost, buyRatio);
      for (let n = 0; n < qty; n++) buyLines.push({ uuid: doc.uuid, name: doc.name, price });
    }
    const sellLines = sell.map((item) => ({ id: item.id, name: item.name, price: sellPrice(item.system.cost, ratio) }));
    // `rule` is whether a drawn line follows the row — the buy lines and the sell lines are one
    // list to the eye, and a rule never sits under the last of it.
    const lines = buyLines.length + sellLines.length;
    context.cart = {
      buy: buyLines.map((line, i) => ({ ...line, rule: i < lines - 1 })),
      sell: sellLines.map((line, i) => ({ ...line, rule: buyLines.length + i < lines - 1 })),
      empty: !lines
    };
    const summary = cartSummary({ items: actor.items.contents, gold: actor.system.gold, buy, sell, ratio, buyRatio, slotsMax: actor.system.slotsMax });
    context.summary = summary;
    context.slotsMax = actor.system.slotsMax;
    // Whether the trade will go through, as one glyph beside Confirm. It used to be a line of
    // words above the button, which pushed the button about every time the answer changed — the
    // till's layout moved while the reader was aiming at it. The glyph never changes size, so
    // the band is still. It carries its own tooltip and is NOT the button, which is the whole
    // point: a disabled button takes no pointer and so opens no tooltip of its own.
    context.status = summary.empty
      ? { icon: "fa-circle-minus", tone: "is-idle", label: game.i18n.localize("CAIRN.Store.CartEmpty") }
      : summary.short ? { icon: "fa-circle-exclamation", tone: "is-blocked", label: game.i18n.localize("CAIRN.Store.Short") }
        : !summary.fitsBody ? { icon: "fa-circle-exclamation", tone: "is-blocked", label: game.i18n.localize("CAIRN.Store.NoRoom") }
          : summary.needsContainer ? { icon: "fa-circle-question", tone: "is-asking", label: game.i18n.localize("CAIRN.Store.NeedsContainer") }
            : { icon: "fa-circle-check", tone: "is-ok", label: game.i18n.localize("CAIRN.Store.WillGoThrough") };
    return context;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    // A plain ApplicationV2 has no drag-drop of its own, so the window binds its own instance.
    this.#dragDrop.bind(this.element);
  }

  /** @override */
  _attachPartListeners(partId, htmlElement, options) {
    super._attachPartListeners(partId, htmlElement, options);
    // The <select> is a change, not a click, so it is not an action.
    htmlElement.querySelector("select[name=store]")?.addEventListener("change", (event) => {
      this.#storeId = event.currentTarget.value;
      this.#cart = { buy: new Map(), sell: new Set() };
      this.render();
    });
  }

  /** @override — the cart does not outlive the window. */
  _onClose(options) {
    super._onClose(options);
    this.#cart = { buy: new Map(), sell: new Set() };
  }

  /**
   * One instance for both roles. The Warden drops Items on the shelves; a shopper drags a shelf
   * row or one of their own onto the cart. `dropSelector` names both targets, and the callback
   * tells them apart by which one the drop landed on.
   */
  get #dragDrop() {
    return this.#dd ??= new foundry.applications.ux.DragDrop.implementation({
      dragSelector: ".draggable",
      dropSelector: ".cairn-store-list, .cairn-store-cart",
      permissions: {
        dragstart: () => !game.user.isGM,
        drop: () => true
      },
      callbacks: {
        dragstart: this.#onDragStart.bind(this),
        drop: this.#onDrop.bind(this)
      }
    });
  }

  /** A row on its way to the cart: the shelf row's uuid, or the own row's item id. */
  #onDragStart(event) {
    const row = event.currentTarget;
    const payload = { type: STORE_DRAG, uuid: row.dataset.uuid ?? "", itemId: row.dataset.itemId ?? "" };
    event.dataTransfer.setData("text/plain", JSON.stringify(payload));
  }

  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (event.currentTarget.matches(".cairn-store-cart")) return this.#onDropOnCart(data);
    if (!game.user.isGM) return;
    const store = this.#store;
    if (!store) return;
    // A folder stocks the whole shelf at once; a single Item is listed once, and either way only
    // if it is the kind a store sells.
    if (data?.type === "Folder") return this.#onDropFolder(store, data);
    if (data?.type !== "Item") return;
    const item = await Item.implementation.fromDropData(data);
    if (!sellable(item)) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Store.NotSellable"));
      return;
    }
    await this.#save(withItem(store, item.uuid));
  }

  /**
   * A folder of items dropped on the shelves lists everything in it, subfolders included.
   *
   * Both sidebars hand over the same payload — `{ type: "Folder", uuid }`, with the pack, if
   * there is one, inside the uuid — so there is one path for a world folder and a compendium
   * one. The difference is what `Folder#contents` answers with: Documents for a world folder,
   * pack INDEX ENTRIES for a compendium one. That is why the second case fetches the documents
   * by id first: `sellable` asks a document what it is, and an index row only carries what its
   * pack happens to index.
   */
  async #onDropFolder(store, data) {
    const folder = await foundry.documents.Folder.implementation.fromDropData(data);
    if (folder?.type !== "Item") {
      ui.notifications.warn(game.i18n.localize("CAIRN.Store.FolderNotItems"));
      return;
    }
    const pack = folder.pack ? game.packs.get(folder.pack) : null;
    const rows = folderTree(folder, pack ? pack.folders : game.folders).flatMap((f) => f.contents);
    const items = pack
      ? rows.length ? await pack.getDocuments({ _id__in: rows.map((row) => row._id) }) : []
      : rows;
    const uuids = items.filter((item) => sellable(item)).map((item) => item.uuid);
    if (!uuids.length) {
      ui.notifications.warn(game.i18n.localize("CAIRN.Store.FolderEmpty"));
      return;
    }
    const next = withItems(store, uuids);
    const added = next.items.length - store.items.length;
    // A folder dropped twice adds nothing, and "0 items are on the shelves" is not what happened.
    if (!added) {
      ui.notifications.info(game.i18n.localize("CAIRN.Store.FolderNothingNew", { folder: folder.name }));
      return;
    }
    await this.#save(next);
    ui.notifications.info(game.i18n.localize("CAIRN.Store.FolderAdded", { count: added, folder: folder.name }));
  }

  /** A drag onto the cart is the row's `+`. */
  #onDropOnCart(data) {
    if (game.user.isGM || data?.type !== STORE_DRAG) return;
    if (data.uuid) this.#addToCart(data.uuid);
    else if (data.itemId) this.#addToSell(data.itemId);
  }

  #addToCart(uuid) {
    if (!this.#store?.items.includes(uuid)) return;
    this.#cart.buy.set(uuid, (this.#cart.buy.get(uuid) ?? 0) + 1);
    this.render();
  }

  #addToSell(itemId) {
    if (!game.user.character?.items.get(itemId)) return;
    this.#cart.sell.add(itemId);
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions                                     */
  /* -------------------------------------------- */

  /**
   * Ask for a name — the idiom of the sheet's Create Item prompt. Null ONLY when the dialog was
   * dismissed; an empty field comes back as `""`, because leaving it blank is an answer and the
   * caller is the one that knows what to do with it.
   */
  static async #askName(title, initial = "") {
    const result = await DialogV2.prompt({
      classes: [SYSTEM_ID],
      window: { title: game.i18n.localize(title) },
      content: `
        <div class="cairn-field">
          <label>${game.i18n.localize("CAIRN.Name")}</label>
          <input type="text" name="name" value="${foundry.utils.escapeHTML(initial)}" autofocus>
        </div>`,
      ok: {
        label: game.i18n.localize("CAIRN.Store.SaveName"),
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
      },
      rejectClose: false
    });
    return result ? result.name.trim() : null;
  }

  /** @this {CairnStore} */
  static async #onStoreNew() {
    if (!game.user.isGM) return;
    const name = await CairnStore.#askName("CAIRN.Store.NewTitle");
    // Dismissed is "never mind"; blank is "you name it". The store is made either way but the
    // second one, so a Warden who just wants a shelf to drop a folder on gets one.
    if (name === null) return;
    const stores = this.#stores;
    this.#storeId = foundry.utils.randomID();
    await this.#save(blankStore(name || untitledName(
      game.i18n.localize("CAIRN.Store.Untitled"),
      Object.values(stores).map((s) => s.name)
    )));
  }

  /**
   * A store's own settings: its name, what it pays for a thing and what it charges for one.
   * Written straight into the setting like every other edit in this window — there is no draft
   * and no Save-or-lose-it. `<range-picker>` is form-associated, so `FormDataExtended` hands
   * both rates back as Numbers with no `data-dtype` on them.
   * @this {CairnStore}
   */
  static async #onStoreSettings() {
    const store = this.#store;
    if (!game.user.isGM || !store) return;
    const content = await foundry.applications.handlebars.renderTemplate(SETTINGS_TPL, {
      name: store.name,
      sellRatio: store.sellRatio,
      buyRatio: store.buyRatio ?? 100
    });
    const result = await DialogV2.prompt({
      classes: [SYSTEM_ID],
      window: { title: game.i18n.localize("CAIRN.Store.SettingsTitle") },
      content,
      // A dialog has no ink pass of its own; the name's ruled underline is drawn.
      render: (_event, dialog) => scheduleInk(dialog.element.querySelector(".window-content")),
      ok: {
        label: game.i18n.localize("CAIRN.Store.SaveName"),
        callback: (event, button) => new foundry.applications.ux.FormDataExtended(button.form).object
      },
      rejectClose: false
    });
    const name = result?.name?.trim();
    if (!name) return;
    await this.#save(withSettings(store, { name, sellRatio: result.sellRatio, buyRatio: result.buyRatio }));
  }

  /** @this {CairnStore} */
  static async #onStoreDelete() {
    const store = this.#store;
    if (!game.user.isGM || !store) return;
    const yes = await DialogV2.confirm({
      classes: [SYSTEM_ID],
      window: { title: "CAIRN.Store.DeleteTitle" },
      content: `<p>${game.i18n.localize("CAIRN.Store.DeleteConfirm", { name: foundry.utils.escapeHTML(store.name) })}</p>`
    });
    if (!yes) return;
    const stores = { ...this.#stores };
    delete stores[this.#storeId];
    this.#storeId = null;
    await game.settings.set(SYSTEM_ID, SETTINGS.STORES, stores);
  }

  /** The × on a shelf row: off the shelf, not out of the world. @this {CairnStore} */
  static async #onStoreRemove(event, target) {
    const store = this.#store;
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!game.user.isGM || !store || !uuid) return;
    await this.#save(withoutItem(store, uuid));
  }

  /** The Warden asks every connected client to open its own window on this store. @this {CairnStore} */
  static #onStoreOpenAll() {
    if (!game.user.isGM || !this.#store) return;
    game.socket.emit(`system.${SYSTEM_ID}`, { type: "openStore", storeId: this.#storeId });
    ui.notifications.info(game.i18n.localize("CAIRN.Store.Pushed"));
  }

  /** A row's name opens the item's own sheet — read-only for a player, as any pack item is. */
  static async #onOpenItem(event, target) {
    const row = target.closest("[data-uuid], [data-item-id]");
    const item = row?.dataset.uuid ? await fromUuid(row.dataset.uuid) : game.user.character?.items.get(row?.dataset.itemId);
    item?.sheet.render({ force: true });
  }

  /** The shelf row's `+`. @this {CairnStore} */
  static #onCartAdd(event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (uuid) this.#addToCart(uuid);
  }

  /** The own row's `+`. @this {CairnStore} */
  static #onCartSell(event, target) {
    const id = target.closest("[data-item-id]")?.dataset.itemId;
    if (id) this.#addToSell(id);
  }

  /**
   * A cart line's ×. One line is one unit — three Rations are three lines, not a line with a
   * counter on it — so taking a buy line out takes ONE off the count, and the last one takes
   * the row with it. A sell line is the item itself and goes whole.
   * @this {CairnStore}
   */
  static #onCartRemove(event, target) {
    const row = target.closest("[data-uuid], [data-sell-id]");
    const uuid = row?.dataset.uuid;
    if (uuid) {
      const qty = this.#cart.buy.get(uuid) ?? 0;
      if (qty > 1) this.#cart.buy.set(uuid, qty - 1);
      else this.#cart.buy.delete(uuid);
    }
    if (row?.dataset.sellId) this.#cart.sell.delete(row.dataset.sellId);
    this.render();
  }

  /**
   * The checkout, in order: the container question first (so a cancel leaves the character
   * exactly as they were), then the sold things go, then the bought ones arrive on the body,
   * then the coin moves by the phase's rules, then the record. The charge is the price of what
   * `createEmbeddedDocuments` returned, not of what was asked: the document creates the prefix of
   * a batch that fits and warns about the rest, and coin is never taken for a thing that did not
   * arrive.
   * @this {CairnStore}
   */
  static async #onCheckout() {
    const actor = game.user.character;
    const store = this.#store;
    if (game.user.isGM || !actor || !store) return;
    const ratio = store.sellRatio;
    const buyRatio = store.buyRatio ?? 100;
    const docs = await Promise.all([...this.#cart.buy.keys()].map((uuid) => fromUuid(uuid)));
    const buy = docs.filter((doc) => doc).map((doc) => ({ doc, qty: this.#cart.buy.get(doc.uuid) }));
    const sell = [...this.#cart.sell].map((id) => actor.items.get(id)).filter((item) => item);
    // Against the character as they stand now, not as the foot last drew them: a stale window.
    const summary = cartSummary({ items: actor.items.contents, gold: actor.system.gold, buy, sell, ratio, buyRatio, slotsMax: actor.system.slotsMax });
    if (!summary.ok) {
      this.render();
      return;
    }

    // 1. The question, before anything is written.
    let place = "";
    if (summary.net > 0) {
      place = await chooseGainPlace(actor, summary.net, { bodyFree: summary.bodyFree, containerFree: summary.containerFree });
      if (place === null) return;
    }
    const goldBefore = actor.system.gold;
    const sold = sell.map((item) => ({ name: item.name, price: sellPrice(item.system.cost, ratio) }));

    // 2. Sold things go.
    if (sell.length) await actor.deleteEmbeddedDocuments("Item", sell.map((item) => item.id));

    // 3. Bought things arrive on the body: a stripped `toObject()` per unit, as the generator embeds.
    const data = [];
    for (const { doc, qty } of buy) {
      const obj = copyOf(doc);
      Object.assign(obj.system, { container: "", carried: true, equipped: false });
      for (let n = 0; n < qty; n++) data.push(foundry.utils.deepClone(obj));
    }
    const created = data.length ? await actor.createEmbeddedDocuments("Item", data) : [];
    // What the shelf showed, not what the book says: the markup is the store's, and the copy the
    // character walks out with keeps the item's own cost.
    const charged = created.reduce((n, item) => n + buyPrice(item.system.cost, buyRatio), 0);

    // 4. Coin moves last. A gain the chosen place refuses after all — the character changed under
    //    the window — is set aside rather than lost: Belongings has no limit.
    const delta = summary.sellTotal - charged;
    if (delta > 0 && !(await applyGold(actor, delta, place))) {
      await applyGold(actor, delta, BELONGINGS);
      ui.notifications.warn(game.i18n.localize("CAIRN.Store.CoinSetAside", { amount: delta }));
    } else if (delta < 0) {
      await applyGold(actor, delta);
    }

    // 5. The record.
    await postStoreCard({ actor, storeName: store.name, bought: created, buyRatio, sold, goldBefore, goldAfter: actor.system.gold });
    this.#cart = { buy: new Map(), sell: new Set() };
    this.render();
  }
}

/**
 * The public chat card a checkout leaves: who, at which store, bought what for how much, sold
 * what for how much, and gold before → after. Bought things are folded by name (three Rations is
 * one line). The store's name is the caption — the message's `flavor`, as on every card.
 * @param {{ actor: Actor, storeName: string, bought: Item[], buyRatio: number,
 *   sold: {name: string, price: number}[], goldBefore: number, goldAfter: number }} data
 */
async function postStoreCard({ actor, storeName, bought, buyRatio, sold, goldBefore, goldAfter }) {
  const lines = new Map();
  for (const item of bought) {
    const line = lines.get(item.name) ?? { name: item.name, qty: 0, total: 0 };
    line.qty += 1;
    line.total += buyPrice(item.system.cost, buyRatio);
    lines.set(item.name, line);
  }
  const content = await foundry.applications.handlebars.renderTemplate(CARD_TPL, {
    bought: [...lines.values()],
    sold,
    goldBefore,
    goldAfter
  });
  return ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), flavor: storeName, content });
}
