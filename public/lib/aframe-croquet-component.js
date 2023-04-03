/*
The MIT License (MIT)
Copyright (c) 2019-2023 Nikolai Suslov | Krestianstvo.org and contributors
*/

if (typeof AFRAME === 'undefined') {
    throw new Error('Component attempted to register before AFRAME was available.');
}

let Q = Croquet.Constants;
Q.STEP_MS = 1000 / 20;
Q.AVATAR_PREFIX = 'avatar-';
Q.THROTTLED_ATTRIBUTES = ['position', 'rotation', 'scale'];
Q.SYNCABLE_ATTRIBUTES = [...Q.THROTTLED_ATTRIBUTES, 'multiuser'];
Q.COLORS = ['purple', 'blue', 'green', 'orange', 'yellow', 'red', 'gray', 'white', 'maroon', 'navy', 'aqua', 'lime', 'olive', 'teal', 'fuchsia', 'silver', 'black'];
Q.INITIAL_PLACEMENT_RADIUS = 7;

class RootModel extends Croquet.Model {

    init(options) {
        super.init(options);
        this.children = new Map();
        //Aware of Users
        this.userData = new Map();
        this.subscribe(this.sessionId, "view-join", this.addUser);
        this.subscribe(this.sessionId, "view-exit", this.deleteUser);
        this.subscribe(this.id, 'onDeleteUser', this.onDeleteUser);
        this.subscribe(this.id, 'add-multiuser-model', this.onComponentAdd);
        this.subscribe(this.id, 'delete-multiuser-model', this.onDeleteComponent);
    }

    newId() {
        function hex() {
            let r = Math.random();
            return Math.floor(r * 256).toString(16).padStart(2, "0");
        }

        return `${hex()}${hex()}${hex()}${hex()}`;
    }

    onDeleteComponent(elID) {

        let component = this.children.get(elID);
        if (component) {
            component.destroy();
            this.children.delete(elID);
            console.debug("RootModel: Model component deleted:", elID, component);
            this.publish(this.id, 'component-deleted', elID);
        }

    }

    onComponentAdd(data) {

        let elID = data.elID;

        if (!this.children.has(elID)) {
            let component = ComponentModel.create(data);
            this.children.set(elID, component);
            console.debug("RootModel: Model component added:", elID, component);
            this.publish(this.id, 'component-added', elID);
        }
    }



    addUser(viewId) {
        let data = this.userData.get(viewId);
        if (data) {
            data.online = true;
            const timeSec = (this.now() - data.start) / 1000;
            console.info(`RootModel: user ${data.color} ${viewId} rejoining & first joined ${timeSec} seconds ago (${this.viewCount} of ${this.userData.size} user(s) online):`, data);
        } else {
            const theta = this.random() * 2 * Math.PI;
            const x = Q.INITIAL_PLACEMENT_RADIUS * Math.sin(theta);
            const z = Q.INITIAL_PLACEMENT_RADIUS * Math.cos(theta);
            const heading = (theta / Math.PI) * 180 + 180;
            data = {
                online: true,
                start: this.now(),
                color: Q.COLORS[this.userData.size % Q.COLORS.length],
                position: {x, y: 0.8, z},
                rotation: {x: 0, y: heading, z: 0},
            };
            this.userData.set(viewId, data);
            console.info(`RootModel: user ${data.color} ${viewId} joining (${this.viewCount} of ${this.userData.size} user(s) online)`, data);
        }

        const elID = Q.AVATAR_PREFIX + viewId;
        let userModel = this.children.get(elID);
        if (userModel) {
            console.debug(`RootModel: user ${data.color} ${viewId} joining; userModel exists:`, userModel);
        } else {
            const options = {
                elID: elID,
                color: data.color,
                // sceneModel: this,
                components: {
                    position: {x: data.position.x || 0, y: data.position.y || 0.8, z: data.position.z || -Q.INITIAL_PLACEMENT_RADIUS},
                    rotation: {x: data.rotation.x || 0, y: data.rotation.y || 0, z: data.rotation.z || 0},
                    multiuser: {},
                }
            }
            console.debug(`RootModel: user ${data.color} ${viewId} joining; created userModel:`, options);
            this.onComponentAdd(options)
        }

        this.publish(this.sessionId, 'user-added', viewId);
    }


    deleteUser(viewId) {
        const data = this.userData.get(viewId);
        data.online = false;   // retains data, including color & positions
        const time = this.now() - this.userData.get(viewId)?.start;
        const elID = Q.AVATAR_PREFIX + viewId;
        const userModel = this.children.get(elID);
        if (userModel) {
            data.position = structuredClone(userModel.components.position);
            data.rotation = structuredClone(userModel.components.rotation);
        }
        console.info(`user ${data?.color} ${viewId} left after ${time / 1000} seconds (${this.viewCount} of ${this.userData.size} user(s) online):`, data);
        this.onDeleteComponent(elID)
        this.publish(this.sessionId, 'user-exit', viewId);
        //this.publish(this.viewId, 'onDeleteUser', viewId);
    }

    onDeleteUser(viewId) {
        if (this.userData.has(viewId)) {
            this.userData.delete(viewId);
        }
    }

}

class RootView extends Croquet.View {

    constructor(model) {
        super(model);

        let self = this;

        this.children = {};
        this.sceneModel = model;
        this.aframeScene = document.querySelector('a-scene');

        this.aframeScene.addEventListener('add-multiuser', function (event) {
            let comp = event.detail.comp;
            if (!comp.ready) {
                comp.ready = true;
                if (!Object.keys(self.children).includes(comp.el?.id)) {
                    console.debug('RootView: multiuser component ready; checking for ComponentModel:', comp.el?.id, event.detail);
                    let elID = comp.el.id;
                    let elType = comp.el.localName;   // TODO: include serialized components
                    self.publish(model.id, "add-multiuser-model", { elID, elType });
                }
            }
        });

        this.aframeScene.addEventListener('deleteComponent', function (event) {

            let data = event.detail.data;
            console.debug('Delete multiuser component from scene: ', data);
            self.removeChild(data);
            self.publish(model.id, 'delete-multiuser-model', data);

        })

        this.subscribe(this.sessionId, 'user-added', this.onUserAdded);
        this.subscribe(this.sessionId, 'user-exit', this.onUserExit);
        this.subscribe(model.id, 'component-added', this.addViewComponent);
        this.subscribe(model.id, 'component-deleted', this.removeChild)
        this.subscribe(this.viewId, "synced", this.synced);

        for (const [id, data] of model.userData.entries()) {
            if (data?.online) {
                this.addViewComponent(Q.AVATAR_PREFIX + id);
            } else {
                this.removeChild(Q.AVATAR_PREFIX + id);
            }
        }
    }

    addViewComponent(elID) {

        if (!Object.keys(this.children).includes(elID)) {
            let component = this.sceneModel.children.get(elID);
            console.debug('RootView: adding view component:', elID, component);
            let componentView = new ComponentView(component);
            this.children[elID] = componentView;
        } else {
            console.debug('RootView: View component exists:', elID);
        }
    }

    synced() {
        console.info('RootView: synced: creating views for models:', this.sceneModel.children);
        for (const el of this.sceneModel.children.keys()) {
            this.addViewComponent(el);
        }
    }

    onUserAdded(id) {
    }

    onUserExit(id) {
    }

    removeChild(childID) {
        const child = this.children[childID];
        child?.detach();
        delete this.children[childID];
    }

    detach() {
        super.detach();
        Object.keys(this.children).forEach(key => {
            this.removeChild(key)
        })
    }

}

class ComponentModel extends Croquet.Model {

    init(options) {
        super.init(options);

        this.components = {   // position, rotation, etc. will be saved here
            multiuser: {
                anim: false
            }
        };
        Object.assign(this, options);

        this.sceneModel = this.wellKnownModel("modelRoot");
        this.subscribe(this.id, 'changeComponent', this.changeComponent);
        this.future(Q.STEP_MS).step();

    }

    step() {

        if (this.components.multiuser.anim) {
            this.rotate()
        }
        this.future(Q.STEP_MS).step();

    }

    rotate() {
        let t = this.now()
        let rot = this.components.rotation;
        if (this.components.rotation) {
            let newRotation =
            {
                rotation:
                    { x: rot.x, y: Math.sin(t / 1000) * 50, z: Math.sin(t / 2000) * 30 }
            };
            this.changeComponent({ data: newRotation, senderId: 'model' });
        }
    }

    merge(target, source) {
        // Iterate through `source` properties and if an `Object` set property to merge of `target` and `source` properties
        for (const key of Object.keys(source)) {
            if (!target[key]) {
                target[key] = {}
            }
            if (source[key] instanceof Object) Object.assign(source[key], this.merge(target[key], source[key]))
        }
        // Join `target` and modified `source`
        return Object.assign(target || {}, source)
    }

    changeComponent(changed) {
        //update model components
        let diff = JSON.parse(JSON.stringify(changed.data)); //deep object clone
        this.merge(this.components, changed.data);
        this.publish(this.id, 'modelChanged', { senderId: changed.senderId, data: diff });
        //console.log('ComponentModel: Model is changed with: ', diff, ' from ', changed.senderId);
    }
}


class ComponentView extends Croquet.View {

    constructor(model) {
        super(model);

        console.debug(`ComponentView: constructing from`, model);
        this.elementModel = model;
        this.aframeScene = document.querySelector('a-scene');
        this.aframeEl = this.aframeScene.querySelector('#' + this.elementModel.elID);
        this.handlers = {   // addEventListener won't add an identical function twice
            onSetAttribute: this.onSetAttribute.bind(this),
        }

        this.subscribe(model.id, { event: 'modelChanged', handling: 'oncePerFrame' }, this.changeView);

        if (Object.entries(model.components).length > 1) {   // model has data
            // TODO: find better way to ensure ComponentViews get initialized, and with current data
            this.subscribe(this.viewId, "synced", this.initViewFromModel);
            setTimeout(this.initViewFromModel.bind(this), 1000);
        } else {   // model doesn't have data, so pull from A-Frame element
            this.initViewFromAFrame();
        }
    }

    initViewFromModel() {
        if (this.isInitialized) { return; }
        console.info('ComponentView: init A-Frame element from model:', this.elementModel);

        if (! this.aframeEl) {
            this.aframeEl = this.createElement(this.elementModel);
        } else {
            // set from model components
            this.aframeEl.emit('update-aframe-element', {data: this.elementModel.components});
        }
        this.aframeEl.addEventListener('setAttribute-event', this.handlers.onSetAttribute);

        this.isInitialized = true;
    }

    createElement(model) {
        let element;
        if (model.elID.startsWith(Q.AVATAR_PREFIX)) {
            const avatarId = model.elID.slice(Q.AVATAR_PREFIX.length);
            if (avatarId === this.viewId) {   // the local user
                console.debug(`ComponentView: creating avatar for local user ${model.color} ${avatarId}`);
                element = document.createElement('a-box');
                element.setAttribute('height', 2);
                element.setAttribute('wireframe', true);
                element.setAttribute('visible', false);
                element.dataset.isLocalAvatar = true;
            } else {
                console.debug(`ComponentView: creating avatar for remote user ${model.color} ${avatarId}`);
                const avatarTemplate = document.getElementById('avatarTemplate');
                element = avatarTemplate ?
                    avatarTemplate.content.firstElementChild.cloneNode(true) :
                    document.createElement('a-box');
            }
            element.setAttribute('id', model.elID);
            const pos = model.components.position;
            element.setAttribute('position', `${pos.x} ${pos.y} ${pos.z}`);
            const rot = model.components.rotation;
            element.setAttribute('rotation', `${rot.x} ${rot.y} ${rot.z}`);
            element.setAttribute('color', model.color);
            // multiuser may need to be set last
            element.setAttribute('multiuser', AFRAME.utils.styleParser.stringify(model.components.multiuser));
        } else {   // ordinary A-Frame element
            console.debug(`ComponentView: creating element from`, model);
            element = document.createElement(model.elType);
            element.setAttribute('id', model.elID);
            // Model fields MUST NOT be passed to functions that might modify them.
            for (const [attrName, attrValue] of Object.entries(model.components)) {
                element.setAttribute(attrName, toAFrameValue(attrName, attrValue));
            }
        }
        AFRAME.scenes[0].appendChild(element);
        console.debug(`ComponentView: added element:`, element);
        return element;
    }

    initViewFromAFrame() {
        if (!this.aframeEl) {
            console.error(`ComponentView: need A-Frame element to init empty ComponentModel`);
            return;
        }
        console.info('ComponentView: init ComponentModel from A-Frame element:', this.aframeEl);

        this.aframeEl.addEventListener('setAttribute-event', this.handlers.onSetAttribute);

        let newModelComponents = {};
        let elementComponents = this.aframeEl?.components;
        const isAvatar = this.elementModel?.elID?.startsWith(Q.AVATAR_PREFIX);

        // Filters component values & replaces elements with IDs, so the model can save them
        Object.keys(elementComponents).forEach(componentName => {
            const prop = this.aframeEl?.getAttribute(componentName);
            const [isSyncable, serializedValue] = this.filterComponent(isAvatar, componentName, prop);
            if (isSyncable) {
                newModelComponents[componentName] = serializedValue;
            }
        })
        this.publish(this.elementModel.id, 'changeComponent', { data: newModelComponents, senderId: this.viewId });
    }

    onSetAttribute(event) {
        const isAvatar = this.elementModel?.elID?.startsWith(Q.AVATAR_PREFIX);
        let data = event.detail.data;
        const [isSyncable, serializedValue] = this.filterComponent(isAvatar, data.attrName, data.value);
        if (isSyncable) {
            this.publish(this.elementModel.id, 'changeComponent', { data: { [data.attrName]: serializedValue }, senderId: this.viewId });
        }
    }

    filterComponent(isAvatar, componentName, componentValue) {
        if (!isAvatar || Q.SYNCABLE_ATTRIBUTES.includes(componentName)) {
            try {
                if (componentValue && 'object' === typeof componentValue) {
                    const serializedProp = {};
                    for (const [key, value] of Object.entries(componentValue)) {
                        if (value instanceof HTMLElement) {   // presumably an asset
                            serializedProp[key] = '#' + value.id;
                        } else {
                            serializedProp[key] = structuredClone(value);
                        }
                    }
                    return [true, serializedProp];
                } else {
                    return [true, structuredClone(componentValue)];
                }
            } catch (err) {
                console.error(`ComponentView: while copying component ${componentName}:`, componentValue, err);
                return [false, null];
            }
        } else {
            console.debug(`ComponentView: not setting avatar ${componentName} to`, componentValue);
            return [false, null];
        }
    }

    changeView(changed) {
        if (this.aframeEl) {
            this.aframeEl.emit('update-aframe-element', {data: changed.data});
        } else {
            console.warn(`ComponentView: can't update non-existant element:`, this.elementModel?.elID);
        }
    }

    detach() {
        super.detach();

        if (this.aframeEl) {
            console.debug(`ComponentView: removing element ${this.elementModel?.elID} and view`);
            this.aframeEl.parentNode.removeChild(this.aframeEl);
            this.aframeEl.destroy();
        } else {
            console.warn(`ComponentView: can't remove non-existent element ${this.elementModel?.elID}`);
        }
    }
}


ComponentModel.register("ComponentModel");
RootModel.register("RootModel");


AFRAME.registerComponent('croquet', {

    schema: {
        sessionName: { default: 'demo' },
        password: { default: 'demo' },
        apiKey: {default: 'myApiKey'}
    },

    init: function () {
        //Croquet.startSession(this.data.sessionName, RootModel, RootView);
        //Croquet.startSession(this.data.sessionName, RootModel, RootView, { step: "manual" })
        let sessionName = this.data.sessionName == 'demo' ? Croquet.App.autoSession() : this.data.sessionName;
        let password = this.data.password == 'demo' ? Croquet.App.autoPassword() : this.data.password;
        let apiKey = this.data.apiKey == 'myApiKey' ? '1MAgJydFdvcKpGkHe7bhxLmr3Hj4mofPKvC06mpII' : this.data.apiKey;
        Croquet.Session.join(
            {
                apiKey: apiKey,
                appId: "com.aframe.multiuser",
                name: sessionName,
                password: password,
                model: RootModel,
                view: RootView
                //debug: ["session"]
            }
        ).then(session => {
            let self = this;
            let xrSession = null;

            function renderFrame(time, xrFrame) {
                session.step(time);
            }

            function onWindowAnimationFrame(time) {
                window.requestAnimationFrame(onWindowAnimationFrame);
                if (!xrSession) {
                    renderFrame(time, null)
                }
            }
            window.requestAnimationFrame(onWindowAnimationFrame)

            function onXRAnimationFrame(time, xrFrame) {
                if(xrSession) {
                    xrSession.requestAnimationFrame(onXRAnimationFrame);
                    renderFrame(time, xrFrame);
                }
            }

            function startXRSession() {
                if (self.el.xrSession) {
                    xrSession = self.el.xrSession
                    xrSession.requestAnimationFrame(onXRAnimationFrame)
                }
            }

            function onXRSessionEnded() {
                xrSession = null
            }

            this.el.addEventListener('enter-vr', startXRSession);
            this.el.addEventListener('exit-vr', onXRSessionEnded);

        });
    },

    update: function (oldData) {
        //TODO: create new user-defined sessions
    },

    tick: function (t) {
    }
})



AFRAME.registerComponent('multiuser', {

    schema: {
        anim: { type: 'boolean', default: false }
    },

    init: function () {
        let self = this;
        this.scene = this.el.sceneEl;
        this.ready = false;
        // Alas, this throttling won't be coordinated with Croquet frames
        this.updateViewThrottled = {};
        for (const attrName of Q.THROTTLED_ATTRIBUTES) {
            this.updateViewThrottled[attrName] = AFRAME.utils.throttle(this.updateView, Q.STEP_MS, this);
        }

        if (this.el.dataset.isLocalAvatar) {
            this.cameraEnt = this.scene.querySelector('[camera]');
            this.rigEnt = this.cameraEnt?.parentElement;
            if ('A-SCENE' === this.rigEnt.nodeName) {
                this.rigEnt = this.cameraEnt;
            }

            const avatarPosition = structuredClone(this.el.components.position.attrValue);
            if (Number.isFinite(avatarPosition.x) && Number.isFinite(avatarPosition.y) && Number.isFinite(avatarPosition.z)) {
                console.info(`multiuser: setting position of rig from avatar:`, avatarPosition);
                this.rigEnt.setAttribute('position', avatarPosition);
            } else {
                console.warn(`multiuser: bad position of avatar:`, avatarPosition);
            }
            const avatarRotation = structuredClone(this.el.components.rotation.attrValue);
            if (Number.isFinite(avatarRotation.x) && Number.isFinite(avatarRotation.y) && Number.isFinite(avatarRotation.z)) {
                console.info(`multiuser: setting rotation of rig from avatar:`, avatarRotation);
                avatarRotation.y -= 180;
                this.rigEnt.setAttribute('rotation', avatarRotation);
            } else {
                console.warn(`multiuser: bad rotation of avatar:`, avatarRotation);
            }
        }

        Reflect.defineProperty(this.el,
            'setAttributeAFrame', {
            value: (this.originalSetAttribute)(),
            writable: true
        }
        )

        Reflect.defineProperty(this.el,
            'setAttribute', {
            value: (this.croquetSetAttribute)(),
            writable: true
        }
        )

        this.el.addEventListener('update-aframe-element', function (event) {
            for (const [key, value] of Object.entries(event.detail.data)) {
                self.el.setAttributeAFrame(key, toAFrameValue(key, value));
                // console.log('multiuser component: Set attribute on element from model: ', key, ' with: ', value)
            }
        })
    },

    //Original definition from A-Frame master
    originalSetAttribute: function () {
        var singlePropUpdate = {};
        var MULTIPLE_COMPONENT_DELIMITER = '__';
        var COMPONENTS = AFRAME.components;

        return function (attrName, arg1, arg2) {
            var newAttrValue;
            var clobber;
            var componentName;
            var delimiterIndex;
            var isDebugMode;
            var key;

            delimiterIndex = attrName.indexOf(MULTIPLE_COMPONENT_DELIMITER);
            componentName = delimiterIndex > 0 ? attrName.substring(0, delimiterIndex) : attrName;

            // Not a component. Normal set attribute.
            if (!COMPONENTS[componentName]) {
                if (attrName === 'mixin') { this.mixinUpdate(arg1); }
                ANode.prototype.setAttribute.call(this, attrName, arg1);
                return;
            }

            // Initialize component first if not yet initialized.
            if (!this.components[attrName] && this.hasAttribute(attrName)) {
                this.updateComponent(
                    attrName,
                    window.HTMLElement.prototype.getAttribute.call(this, attrName));
            }

            // Determine new attributes from the arguments
            if (typeof arg2 !== 'undefined' &&
                typeof arg1 === 'string' &&
                arg1.length > 0 &&
                typeof AFRAME.utils.styleParser.parse(arg1) === 'string') {
                // Update a single property of a multi-property component
                for (key in singlePropUpdate) { delete singlePropUpdate[key]; }
                newAttrValue = singlePropUpdate;
                newAttrValue[arg1] = arg2;
                clobber = false;
            } else {
                // Update with a value, object, or CSS-style property string, with the possiblity
                // of clobbering previous values.
                newAttrValue = arg1;
                clobber = (arg2 === true);
            }

            // Update component
            this.updateComponent(attrName, newAttrValue, clobber);

            // In debug mode, write component data up to the DOM.
            isDebugMode = this.sceneEl && this.sceneEl.getAttribute('debug');
            if (isDebugMode) { this.components[attrName].flushToDOM(); }
        };
    },

    //Modified definition from A-Frame master
    croquetSetAttribute: function () {
        var singlePropUpdate = {};
        var MULTIPLE_COMPONENT_DELIMITER = '__';
        var COMPONENTS = AFRAME.components;
        let self = this

        return function (attrName, arg1, arg2) {
            var newAttrValue;
            var clobber;
            var componentName;
            var delimiterIndex;
            var isDebugMode;
            var key;

            delimiterIndex = attrName.indexOf(MULTIPLE_COMPONENT_DELIMITER);
            componentName = delimiterIndex > 0 ? attrName.substring(0, delimiterIndex) : attrName;

            // Not a component. Normal set attribute.
            if (!COMPONENTS[componentName]) {
                if (attrName === 'mixin') { this.mixinUpdate(arg1); }
                ANode.prototype.setAttribute.call(this, attrName, arg1);
                return;
            }

            // Initialize component first if not yet initialized.
            if (!this.components[attrName] && this.hasAttribute(attrName)) {
                this.updateComponent(
                    attrName,
                    window.HTMLElement.prototype.getAttribute.call(this, attrName));
            }

            // Determine new attributes from the arguments
            if (typeof arg2 !== 'undefined' &&
                typeof arg1 === 'string' &&
                arg1.length > 0 &&
                typeof AFRAME.utils.styleParser.parse(arg1) === 'string') {
                // Update a single property of a multi-property component
                for (key in singlePropUpdate) { delete singlePropUpdate[key]; }
                newAttrValue = singlePropUpdate;
                newAttrValue[arg1] = arg2;
                clobber = false;
            } else {
                // Update with a value, object, or CSS-style property string, with the possiblity
                // of clobbering previous values.
                newAttrValue = arg1;
                clobber = (arg2 === true);
            }

            // Update component
            this.updateComponent(attrName, newAttrValue, clobber);

            if (Q.THROTTLED_ATTRIBUTES.includes(attrName)) {
                self.updateViewThrottled[attrName](attrName, newAttrValue);
            } else {
                this.emit('setAttribute-event', { data: { attrName: attrName, value: newAttrValue, clobber: clobber } }, false)
            }

            // In debug mode, write component data up to the DOM.
            isDebugMode = this.sceneEl && this.sceneEl.getAttribute('debug');
            if (isDebugMode) { this.components[attrName].flushToDOM(); }
        };
    },

    remove: function () {

        //TODO: remove component and restore AFrame default behaviour

        // Reflect.defineProperty(this.el,
        //     'setAttribute', {
        //     value: (this.originalSetAttribute)(),
        //     writable: true
        // })

        // this.scene.emit('deleteComponent', { data: this.el.id }, false);

    },

    updateView: function(attrName, value) {
        // console.debug(`multiuser component: updating avatar ${attrName} to`, value);
        this.el.emit('setAttribute-event', {data: {attrName, value}}, false);
    },

    tick: (function () {   // Uses IIFE to allocate v only once
        const v = new THREE.Vector3();

        return function (t, dt) {
            if (!this.ready) {
                this.scene.emit('add-multiuser', { comp: this }, false);
            } else {
                if (this.rigEnt) {
                    try {
                        let object3D = this.rigEnt.object3D;
                        v.set(0, 0, 0);
                        object3D.localToWorld(v);
                        if (Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z)) {
                            this.el.setAttribute('position', structuredClone(v));
                        } else {
                            console.debug(`multiuser: not updating avatar position with NaN:`, v);
                        }
                    } catch (err) {
                        console.error("while copying camera position & rotation to avatar:", err);
                    }
                }
            }
        }
    })()
})


function toAFrameValue(attrName, attrValue) {
    switch (attrName) {
        case 'position':
        case 'rotation':
        case 'scale':
            return `${attrValue.x} ${attrValue.y} ${attrValue.z}`;
        case 'material':
            return structuredClone(attrValue);
        default:
            if (attrValue instanceof Object) {
                return AFRAME.utils.styleParser.stringify(attrValue);
            } else {
                return attrValue;
            }
    }
}
