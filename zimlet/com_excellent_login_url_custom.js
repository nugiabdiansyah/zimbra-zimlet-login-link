/*
 * Zimbra Admin Extension: com_excellent_login_url_custom
 * Global Manual SSO Login Link Configuration
 * Conforms to CONTRACT.md
 */

if (window.ZaSettings && ZaSettings.EnabledZimlet && ZaSettings.EnabledZimlet["com_excellent_login_url_custom"]) {

    if (!window.ZaExcellentLoginSsoLoaded) {
        window.ZaExcellentLoginSsoLoaded = true;

        // ----------------------------------------------------
        // 1. Data Model
        // ----------------------------------------------------
        function ZaExcellentLoginSso() {
            ZaItem.call(this, "ZaExcellentLoginSso");
            this.attrs = {
                enabled: "false",
                label: "Login via SSO",
                url: ""
            };
            this.name = "com_excellent_login_url_custom";
            this.type = ZaEvent.S_ZIMLET;
            this.id = "com_excellent_login_url_custom";
        }
        ZaExcellentLoginSso.prototype = new ZaItem();
        ZaExcellentLoginSso.prototype.constructor = ZaExcellentLoginSso;

        ZaExcellentLoginSso.DEFAULT_LABEL = "Login via SSO";

        ZaExcellentLoginSso.validateInput = function(enabled, label, url) {
            if (enabled !== "true" && enabled !== "false") {
                return "Enabled must be 'true' or 'false'.";
            }

            if (label !== undefined && label !== null) {
                if (label.length > 128) {
                    return "Label must contain at most 128 characters.";
                }
                for (var i = 0; i < label.length; i++) {
                    var c = label.charCodeAt(i);
                    if (c < 32 || c === 127) {
                        return "Label must not contain ASCII control characters.";
                    }
                }
            }

            if (enabled === "true") {
                if (!url || url.length === 0) {
                    return "SSO Login URL is required when SSO is enabled.";
                }
            }

            if (url && url.length > 0) {
                if (url.length > 2048) {
                    return "URL must contain at most 2048 characters.";
                }
                for (var j = 0; j < url.length; j++) {
                    var uc = url.charCodeAt(j);
                    if (uc <= 32 || uc === 127) {
                        return "URL must not contain whitespace or control characters.";
                    }
                    if (url.charAt(j) === "\\") {
                        return "URL must not contain backslash.";
                    }
                }
                if (!url.toLowerCase().startsWith("https://")) {
                    return "URL must be an absolute HTTPS URL (starts with https://).";
                }
                try {
                    var parsed = new URL(url);
                    if (parsed.protocol !== "https:") {
                        return "URL protocol must be https:.";
                    }
                    if (!parsed.hostname) {
                        return "URL must contain a valid hostname.";
                    }
                    if (parsed.username || parsed.password) {
                        return "URL must not contain credentials (username/password).";
                    }
                    if (parsed.port) {
                        var p = parseInt(parsed.port, 10);
                        if (isNaN(p) || p < 0 || p > 65535) {
                            return "URL port must be between 0 and 65535.";
                        }
                    }
                } catch (e) {
                    return "Invalid URL format: " + e.message;
                }
            }

            return null;
        };

        ZaExcellentLoginSso.prototype.load = function() {
            var zName = "com_excellent_login_url_custom";
            var curCtrl = ZaApp.getInstance().getCurrentController();

            // 1. Flush cache
            try {
                var soapFlush = AjxSoapDoc.create("FlushCacheRequest", ZaZimbraAdmin.URN, null);
                var cacheEl = soapFlush.set("cache");
                cacheEl.setAttribute("type", "zimlet");
                var entryEl = soapFlush.set("entry", null, cacheEl);
                entryEl.setAttribute("by", "name");
                entryEl.appendChild(soapFlush.getDoc().createTextNode(zName));
                ZaRequestMgr.invoke({ soapDoc: soapFlush }, { controller: curCtrl, busyMsg: "Flushing zimlet cache..." });
            } catch (e) {
                if (window.console && console.warn) console.warn("FlushCacheRequest failed:", e);
            }

            // 2. Read GetZimletRequest
            var soapGet = AjxSoapDoc.create("GetZimletRequest", ZaZimbraAdmin.URN, null);
            soapGet.getMethod().setAttribute("attrs", "zimbraZimletHandlerConfig");
            var zimletEl = soapGet.set("zimlet");
            zimletEl.setAttribute("name", zName);
            var resp = ZaRequestMgr.invoke({ soapDoc: soapGet }, { controller: curCtrl, busyMsg: "Loading SSO configuration..." });
            if (!resp || !resp.Body || !resp.Body.GetZimletResponse) {
                throw new Error("Failed to load Zimlet configuration for " + zName + ": invalid response");
            }
            var zObj = resp.Body.GetZimletResponse.zimlet && resp.Body.GetZimletResponse.zimlet[0];
            if (!zObj) {
                throw new Error("Zimlet " + zName + " not found on server");
            }

            var rawXml = "";
            if (zObj.a) {
                for (var i = 0; i < zObj.a.length; i++) {
                    if (zObj.a[i].n === "zimbraZimletHandlerConfig") {
                        rawXml = zObj.a[i]._content;
                        break;
                    }
                }
            } else if (zObj._attrs && zObj._attrs.zimbraZimletHandlerConfig) {
                rawXml = zObj._attrs.zimbraZimletHandlerConfig;
            }

            if (!rawXml) {
                throw new Error("Configuration missing: zimbraZimletHandlerConfig attribute not found on " + zName);
            }

            var enabled = "false";
            var label = ZaExcellentLoginSso.DEFAULT_LABEL;
            var url = "";

            var parser = new DOMParser();
            var xmlDoc = parser.parseFromString(rawXml, "application/xml");
            var parseErr = xmlDoc.getElementsByTagName("parsererror");
            if (parseErr && parseErr.length > 0) {
                throw new Error("Failed to parse zimbraZimletHandlerConfig XML: " + parseErr[0].textContent);
            }
            var props = xmlDoc.getElementsByTagName("property");
            for (var p = 0; p < props.length; p++) {
                var pName = props[p].getAttribute("name");
                var pVal = props[p].textContent || "";
                if (pName === "enabled") enabled = pVal;
                else if (pName === "label") label = pVal;
                else if (pName === "url") url = pVal;
            }

            this.attrs = {
                enabled: enabled === "true" ? "true" : "false",
                label: label || ZaExcellentLoginSso.DEFAULT_LABEL,
                url: url || ""
            };
        };

        ZaExcellentLoginSso.prototype.save = function(enabled, label, url) {
            if (enabled === undefined && this.attrs) enabled = this.attrs.enabled;
            if (label === undefined && this.attrs) label = this.attrs.label;
            if (url === undefined && this.attrs) url = this.attrs.url;

            var err = ZaExcellentLoginSso.validateInput(enabled, label, url);
            if (err) {
                throw new Error(err);
            }

            var normalizedLabel = (label && label.trim().length > 0) ? label : ZaExcellentLoginSso.DEFAULT_LABEL;
            var zName = "com_excellent_login_url_custom";
            var uploadUrl = (typeof appContextPath !== "undefined" && appContextPath) ?
                (appContextPath + "/../service/upload?fmt=extended,raw") : "/service/upload?fmt=extended,raw";
            var curCtrl = ZaApp.getInstance().getCurrentController();

            var doc = document.implementation.createDocument(null, "zimletConfig");
            var root = doc.documentElement;
            root.setAttribute("name", zName);
            root.setAttribute("version", "1.0.0");
            var globalNode = doc.createElement("global");
            root.appendChild(globalNode);

            var p1 = doc.createElement("property");
            p1.setAttribute("name", "enabled");
            p1.textContent = enabled;
            globalNode.appendChild(p1);

            var p2 = doc.createElement("property");
            p2.setAttribute("name", "label");
            p2.textContent = normalizedLabel;
            globalNode.appendChild(p2);

            var p3 = doc.createElement("property");
            p3.setAttribute("name", "url");
            p3.textContent = url || "";
            globalNode.appendChild(p3);

            var serializer = new XMLSerializer();
            var xmlString = serializer.serializeToString(doc);

            var req = new XMLHttpRequest();
            req.open("POST", uploadUrl, false);
            req.setRequestHeader("Cache-Control", "no-cache");
            req.setRequestHeader("X-Requested-With", "XMLHttpRequest");
            req.setRequestHeader("Content-Type", "application/xml;");
            req.setRequestHeader("Content-Disposition", 'attachment; filename="config.xml"');
            if (window.csrfToken) {
                req.setRequestHeader("X-Zimbra-Csrf-Token", window.csrfToken);
            }
            req.send(new Blob([xmlString], { type: "application/xml" }));

            if (req.status !== 200) {
                throw new Error("Upload failed: HTTP " + req.status + " " + req.statusText);
            }

            var respText = req.responseText || "";
            var match = /['"]aid['"]\s*:\s*['"]([^'"]+)['"]/.exec(respText);
            if (!match || !match[1]) {
                match = /200\s*,\s*['"][^'"]*['"]\s*,\s*['"]([^'"]+)['"]/.exec(respText);
            }
            if (!match || !match[1]) {
                throw new Error("Upload failed: unable to parse attachment ID: " + respText);
            }
            var aid = match[1];

            var soapDoc = AjxSoapDoc.create("ConfigureZimletRequest", ZaZimbraAdmin.URN, null);
            var contentEl = soapDoc.set("content", "");
            contentEl.setAttribute("aid", aid);

            var soapResp = ZaRequestMgr.invoke({ soapDoc: soapDoc }, { controller: curCtrl, busyMsg: "Saving SSO configuration..." });
            if (!soapResp || !soapResp.Body || !soapResp.Body.ConfigureZimletResponse) {
                throw new Error("ConfigureZimletRequest failed: unexpected response");
            }

            this.load();
        };

        ZaExcellentLoginSso.A_enabled = "enabled";
        ZaExcellentLoginSso.A_label = "label";
        ZaExcellentLoginSso.A_url = "url";

        ZaExcellentLoginSso.myXModel = {
            items: [
                { id: "name", ref: "name", type: _STRING_ },
                { id: "type", ref: "type", type: _STRING_ },
                { id: ZaExcellentLoginSso.A_enabled, ref: "attrs/" + ZaExcellentLoginSso.A_enabled, type: _STRING_ },
                { id: ZaExcellentLoginSso.A_label, ref: "attrs/" + ZaExcellentLoginSso.A_label, type: _STRING_ },
                { id: ZaExcellentLoginSso.A_url, ref: "attrs/" + ZaExcellentLoginSso.A_url, type: _STRING_ },
                { id: "_statusMsg", ref: "_statusMsg", type: _STRING_ },
                { id: "_statusStyle", ref: "_statusStyle", type: _STRING_ },
                { id: ZaModel.currentTab, ref: ZaModel.currentTab, type: _STRING_ }
            ]
        };

        // ----------------------------------------------------
        // 2. View Definition
        // ----------------------------------------------------
        function ZaExcellentLoginSsoXFormView(parent, entry) {
            ZaTabView.call(this, {
                parent: parent,
                iKeyName: "ZaExcellentLoginSsoXFormView",
                contextId: "EXCELLENT_LOGIN_SSO"
            });
            this.TAB_INDEX = 0;
            this.initForm(ZaExcellentLoginSso.myXModel, this.getMyXForm(entry), null);
        }
        ZaExcellentLoginSsoXFormView.prototype = new ZaTabView();
        ZaExcellentLoginSsoXFormView.prototype.constructor = ZaExcellentLoginSsoXFormView;
        ZaTabView.XFormModifiers["ZaExcellentLoginSsoXFormView"] = [];

        ZaExcellentLoginSsoXFormView.prototype.getTitle = function() {
            return "Login via SSO";
        };
        ZaExcellentLoginSsoXFormView.prototype.getTabIcon = function() {
            return "Zimlet";
        };
        ZaExcellentLoginSsoXFormView.prototype.getTabTitle = function() {
            return this.getTitle();
        };
        ZaExcellentLoginSsoXFormView.prototype.getTabToolTip = function() {
            return this.getTitle();
        };

        ZaExcellentLoginSsoXFormView.prototype.setObject = function(entry) {
            this._containedObject = {
                name: entry.name || "com_excellent_login_url_custom",
                type: entry.type || ZaEvent.S_ZIMLET,
                attrs: {
                    enabled: entry.attrs && entry.attrs.enabled === "true" ? "true" : "false",
                    label: (entry.attrs && entry.attrs.label) || ZaExcellentLoginSso.DEFAULT_LABEL,
                    url: (entry.attrs && entry.attrs.url) || ""
                },
                _statusMsg: entry._statusMsg || "",
                _statusStyle: entry._statusStyle || ""
            };
            this._containedObject[ZaModel.currentTab] = "1";
            this._localXForm.setInstance(this._containedObject);
        };

        ZaExcellentLoginSsoXFormView.prototype.getMyXForm = function(entry) {
            var xForm = {
                tableCssStyle: "width:100%;overflow:auto;",
                items: []
            };
            if (ZaTabView.XFormModifiers["ZaExcellentLoginSsoXFormView"]) {
                var mods = ZaTabView.XFormModifiers["ZaExcellentLoginSsoXFormView"];
                for (var i = 0; i < mods.length; i++) {
                    mods[i].call(this, xForm, entry);
                }
            }
            return xForm;
        };

        ZaExcellentLoginSsoXFormView.myXFormModifier = function(xFormObject, entry) {
            var tabKey = ++this.TAB_INDEX;
            this.tabChoices = [
                { value: tabKey, label: "SSO Configuration" }
            ];

            var ssoCase = {
                type: _ZATABCASE_,
                caseKey: tabKey,
                colSizes: ["auto"],
                numCols: 1,
                items: [
                    {
                        type: _ZAGROUP_,
                        items: [
                            {
                                type: _ZA_TOP_GROUPER_,
                                label: "Single Sign-On (SSO) Login Link Settings",
                                numCols: 2,
                                colSizes: ["240px", "auto"],
                                items: [
                                    {
                                        type: _DWT_ALERT_,
                                        colSpan: "*",
                                        containerCssStyle: "padding-bottom:12px",
                                        style: DwtAlert.INFO,
                                        iconVisible: true,
                                        content: "Configure a custom manual SSO link for external identity providers (e.g. Authentik, Keycloak). The link is displayed on the login page below the Sign In button. Local username/password authentication remains active."
                                    },
                                    {
                                        type: _OUTPUT_,
                                        ref: "_statusMsg",
                                        colSpan: "*",
                                        visibilityChecks: [function() {
                                            var m = this.getInstanceValue("_statusMsg");
                                            return !!(m && m.length > 0);
                                        }],
                                        visibilityChangeEventSources: ["_statusMsg", "_statusStyle"],
                                        getDisplayValue: function(val) {
                                            if (!val) return "";
                                            var st = this.getInstanceValue("_statusStyle");
                                            var isErr = (st === "error");
                                            var bg = isErr ? "#fce8e6" : "#e6f4ea";
                                            var border = isErr ? "#fad2cf" : "#ceead6";
                                            var color = isErr ? "#c5221f" : "#137333";
                                            var icon = isErr ? "✕ " : "✓ ";
                                            return '<div id="excellent_sso_status_box" style="padding:10px 14px; margin:4px 0 14px 0; border:1px solid ' + border + '; background:' + bg + '; color:' + color + '; font-weight:600; font-size:13px; border-radius:4px;">' + icon + AjxStringUtil.htmlEncode(val) + '</div>';
                                        }
                                    },
                                    {
                                        ref: ZaExcellentLoginSso.A_enabled,
                                        type: _CHECKBOX_,
                                        id: "excellent_sso_enabled_input",
                                        label: "Enable SSO Link",
                                        trueValue: "true",
                                        falseValue: "false",
                                        subLabel: "Show the SSO login link on the web sign-in screen"
                                    },
                                    {
                                        ref: ZaExcellentLoginSso.A_label,
                                        type: _TEXTFIELD_,
                                        id: "excellent_sso_label_input",
                                        label: "Button / Link Label",
                                        width: "350px",
                                        toolTipContent: "Text displayed on the link. Defaults to 'Login via SSO' if blank (max 128 chars)."
                                    },
                                    {
                                        ref: ZaExcellentLoginSso.A_url,
                                        type: _TEXTFIELD_,
                                        id: "excellent_sso_url_input",
                                        label: "SSO Login URL",
                                        width: "480px",
                                        toolTipContent: "Absolute HTTPS URL to the SSO login endpoint (max 2048 chars). Required when enabled."
                                    },
                                    { type: _SPACER_, height: 16, colSpan: "*" },
                                    {
                                        type: _GROUP_,
                                        numCols: 3,
                                        colSizes: ["140px", "140px", "auto"],
                                        colSpan: "*",
                                        items: [
                                            {
                                                type: _DWT_BUTTON_,
                                                label: "Save Changes",
                                                id: "excellent_sso_save_btn",
                                                width: 130,
                                                onActivate: function() {
                                                    ZaExcellentLoginSsoViewController.onSaveClicked.call(this);
                                                }
                                            },
                                            {
                                                type: _DWT_BUTTON_,
                                                label: "Reload",
                                                id: "excellent_sso_reload_btn",
                                                width: 110,
                                                onActivate: function() {
                                                    ZaExcellentLoginSsoViewController.onReloadClicked.call(this);
                                                }
                                            },
                                            { type: _CELLSPACER_ }
                                        ]
                                    }
                                ]
                            }
                        ]
                    }
                ]
            };

            xFormObject.items = [
                {
                    type: _TAB_BAR_,
                    ref: ZaModel.currentTab,
                    choices: this.tabChoices,
                    cssClass: "ZaTabBar",
                    cssStyle: "display:none;",
                    id: "xform_tabbar"
                },
                {
                    type: _SWITCH_,
                    align: _LEFT_,
                    valign: _TOP_,
                    items: [ssoCase]
                }
            ];
        };
        ZaTabView.XFormModifiers["ZaExcellentLoginSsoXFormView"].push(ZaExcellentLoginSsoXFormView.myXFormModifier);

        // ----------------------------------------------------
        // 3. Controller
        // ----------------------------------------------------
        function ZaExcellentLoginSsoViewController(appCtxt, container) {
            ZaXFormViewController.call(this, appCtxt, container, "ZaExcellentLoginSsoViewController");
            this._UICreated = false;
            this.objType = ZaEvent.S_ZIMLET;
            this.tabConstructor = ZaExcellentLoginSsoXFormView;
        }
        ZaExcellentLoginSsoViewController.prototype = new ZaXFormViewController();
        ZaExcellentLoginSsoViewController.prototype.constructor = ZaExcellentLoginSsoViewController;

        ZaController.initPopupMenuMethods["ZaExcellentLoginSsoViewController"] = [];
        ZaController.setViewMethods["ZaExcellentLoginSsoViewController"] = [];
        ZaController.changeActionsStateMethods["ZaExcellentLoginSsoViewController"] = [];

        ZaExcellentLoginSsoViewController.prototype.getAppBarAction = function() {
            if (AjxUtil.isEmpty(this._appbarOperation)) {
                this._appbarOperation[ZaOperation.SAVE] = new ZaOperation(ZaOperation.SAVE, ZaMsg.TBB_Save, ZaMsg.ALTBB_Save_tt, "Save", "SaveDis", new AjxListener(this, this.saveButtonListener));
                this._appbarOperation[ZaOperation.CLOSE] = new ZaOperation(ZaOperation.CLOSE, ZaMsg.TBB_Close, ZaMsg.ALTBB_Close_tt, "Close", "CloseDis", new AjxListener(this, this.closeButtonListener));
            }
            return this._appbarOperation;
        };

        ZaExcellentLoginSsoViewController.prototype.getAppBarOrder = function() {
            if (AjxUtil.isEmpty(this._appbarOrder)) {
                this._appbarOrder.push(ZaOperation.SAVE);
                this._appbarOrder.push(ZaOperation.CLOSE);
            }
            return this._appbarOrder;
        };

        ZaExcellentLoginSsoViewController.prototype.saveButtonListener = function() {
            if (this._view && this._view._localXForm) {
                var saveBtn = this._view._localXForm.getItemsById("excellent_sso_save_btn");
                if (saveBtn && saveBtn[0]) {
                    ZaExcellentLoginSsoViewController.onSaveClicked.call(saveBtn[0]);
                    return;
                }
            }
        };

        ZaExcellentLoginSsoViewController.setViewMethod = function(item) {
            if (!this._UICreated) {
                this._initPopupMenu();
                this._contentView = this._view = new this.tabConstructor(this._container, item);
                var elements = {};
                elements[ZaAppViewMgr.C_APP_CONTENT] = this._view;
                ZaApp.getInstance().getAppViewMgr().createView(this.getContentViewId(), elements);
                this._UICreated = true;
                ZaApp.getInstance()._controllers[this.getContentViewId()] = this;
            }
            ZaApp.getInstance().pushView(this.getContentViewId());
            if (!item || !item.attrs) {
                item = new ZaExcellentLoginSso();
                item.load();
            }
            this._currentObject = item;
            item[ZaModel.currentTab] = "1";
            this._view.setDirty(false);
            this._view.setObject(item);
        };
        ZaController.setViewMethods["ZaExcellentLoginSsoViewController"].push(ZaExcellentLoginSsoViewController.setViewMethod);

        ZaExcellentLoginSsoViewController.prototype.show = function(entry) {
            if (!entry) {
                entry = new ZaExcellentLoginSso();
                entry.load();
            }
            if (!this.selectExistingTabByItemId(entry.id)) {
                this._setView(entry, true);
            }
        };

        ZaExcellentLoginSsoViewController.onSaveClicked = function() {
            var form = this.getForm();
            var instance = form.getInstance();
            var attrs = instance.attrs || {};

            var enabledInput = document.getElementById("ztabv__EXCELLENT_LOGIN_SSO_excellent_sso_enabled_input");
            var enabled = enabledInput ? (enabledInput.checked ? "true" : "false") : (attrs.enabled === "true" ? "true" : "false");

            var labelInput = document.getElementById("ztabv__EXCELLENT_LOGIN_SSO_excellent_sso_label_input");
            var label = labelInput ? labelInput.value : ((attrs.label !== undefined && attrs.label !== null) ? attrs.label : ZaExcellentLoginSso.DEFAULT_LABEL);

            var urlInput = document.getElementById("ztabv__EXCELLENT_LOGIN_SSO_excellent_sso_url_input");
            var url = urlInput ? urlInput.value : ((attrs.url !== undefined && attrs.url !== null) ? attrs.url : "");

            attrs.enabled = enabled;
            attrs.label = label;
            attrs.url = url;

            var valErr = ZaExcellentLoginSso.validateInput(enabled, label, url);
            if (valErr) {
                instance._statusMsg = valErr;
                instance._statusStyle = "error";
                form.setInstance(instance);
                return;
            }

            try {
                var ctrl = ZaApp.getInstance().getExcellentLoginSsoController();
                var model = ctrl._currentObject || new ZaExcellentLoginSso();
                model.save(enabled, label, url);
                ctrl._currentObject = model;
                ctrl._view.setObject(model);

                var updatedInstance = form.getInstance();
                updatedInstance._statusMsg = "Configuration saved successfully. Changes are active.";
                updatedInstance._statusStyle = "success";
                if (ctrl._view && ctrl._view.setDirty) {
                    ctrl._view.setDirty(false);
                }
                form.setInstance(updatedInstance);
                if (ZaApp.getInstance().getAppCtxt() && ZaApp.getInstance().getAppCtxt().getAppController()) {
                    ZaApp.getInstance().getAppCtxt().getAppController().setActionStatusMsg("SSO configuration saved successfully.");
                }
            } catch (ex) {
                var msg = ex.message || String(ex);
                instance._statusMsg = "Error saving configuration: " + msg;
                instance._statusStyle = "error";
                form.setInstance(instance);
            }
        };

        ZaExcellentLoginSsoViewController.onReloadClicked = function() {
            var form = this.getForm();
            var instance = form.getInstance();
            try {
                var ctrl = ZaApp.getInstance().getExcellentLoginSsoController();
                var model = ctrl._currentObject || new ZaExcellentLoginSso();
                model.load();
                ctrl._currentObject = model;
                ctrl._view.setObject(model);

                var reloadedInstance = form.getInstance();
                reloadedInstance._statusMsg = "Configuration reloaded from server.";
                reloadedInstance._statusStyle = "success";
                if (ctrl._view && ctrl._view.setDirty) {
                    ctrl._view.setDirty(false);
                }
                form.setInstance(reloadedInstance);
            } catch (ex) {
                var msg = ex.message || String(ex);
                instance._statusMsg = "Error reloading configuration: " + msg;
                instance._statusStyle = "error";
                form.setInstance(instance);
            }
        };

        // ----------------------------------------------------
        // 4. Registration & Navigation Hooks
        // ----------------------------------------------------
        ZaZimbraAdmin._EXCELLENT_LOGIN_SSO_VIEW = ZaZimbraAdmin.VIEW_INDEX++;

        ZaApp.prototype.getExcellentLoginSsoController = function() {
            if (!this._controllers[ZaZimbraAdmin._EXCELLENT_LOGIN_SSO_VIEW]) {
                this._controllers[ZaZimbraAdmin._EXCELLENT_LOGIN_SSO_VIEW] = new ZaExcellentLoginSsoViewController(this._appCtxt, this._container);
            }
            return this._controllers[ZaZimbraAdmin._EXCELLENT_LOGIN_SSO_VIEW];
        };

        // Tree modifier (under Configure -> Login via SSO)
        ZaExcellentLoginSso.treeModifier = function(tree) {
            try {
                var parentPath = ZaTree.getPathByArray([ZaMsg.OVP_home, ZaMsg.OVP_configure]);
                var ti = new ZaTreeItemData({
                    parent: parentPath,
                    id: ZaId.getTreeItemId(ZaId.PANEL_APP, ZaId.PANEL_CONFIGURATION, null, "LoginSSOHV"),
                    text: "Login via SSO",
                    mappingId: ZaZimbraAdmin._EXCELLENT_LOGIN_SSO_VIEW
                });
                tree.addTreeItemData(ti);
                if (ZaOverviewPanelController.overviewTreeListeners) {
                    ZaOverviewPanelController.overviewTreeListeners[ZaZimbraAdmin._EXCELLENT_LOGIN_SSO_VIEW] = function(ev) {
                        var controller = ZaApp.getInstance().getExcellentLoginSsoController();
                        if (ZaApp.getInstance().getCurrentController()) {
                            ZaApp.getInstance().getCurrentController().switchToNextView(controller, controller.show, []);
                        } else {
                            controller.show();
                        }
                    };
                }
            } catch (e) {
                if (window.console && console.error) console.error("Error adding Login SSO tree item:", e);
            }
        };

        if (ZaOverviewPanelController.treeModifiers) {
            ZaOverviewPanelController.treeModifiers.push(ZaExcellentLoginSso.treeModifier);
        }

        // Double-click hook on Zimlets / Admin Extensions list
        if (window.ZaZimletViewController) {
            var _origZimletShow = ZaZimletViewController.prototype.show;
            ZaZimletViewController.prototype.show = function(entry, skipRefresh) {
                if (entry && entry.name === "com_excellent_login_url_custom") {
                    var ssoCtrl = ZaApp.getInstance().getExcellentLoginSsoController();
                    if (this.switchToNextView) {
                        this.switchToNextView(ssoCtrl, ssoCtrl.show, [entry]);
                    } else {
                        ssoCtrl.show(entry);
                    }
                    return;
                }
                return _origZimletShow.apply(this, arguments);
            };
        }
    }
}
