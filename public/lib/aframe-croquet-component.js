/*
The MIT License (MIT)
Copyright (c) 2020 Nikolai Suslov | Krestianstvo.org
*/

if (typeof AFRAME === 'undefined') {
    throw new Error('Component attempted to register before AFRAME was available.');
}

let Q = Croquet.Constants;
Q.STEP_MS = 1000 / 20;
Q.RIG_ID = 'rig';
Q.AVATAR_PREFIX = 'avatar-';
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

    onDeleteComponent(data) {

        let component = this.children.get(data);
        if (component) {
            component.destroy();
            this.children.delete(data);
        }

    }

    onComponentAdd(data) {

        let elID = data.elID;
        const rig = data.rig;

        if (!this.children.has(elID)) {
            let component = ComponentModel.create(data);
            this.children.set(elID, component);
            console.log("RootModel: Model component added:", elID, data);
        }
        this.publish(this.id, 'component-added', elID);
    }



    addUser(id) {
        let numOnline = 1;
        for (const userDatum of this.userData.values()) { if (userDatum.online) { ++numOnline; } }

        const data = this.userData.get(id);
        if (data) {
            data.online = true;
            const timeSec = (this.now() - data.start) / 1000;
            console.info(`RootModel: user ${data.color} ${id} rejoining & first joined ${timeSec} seconds ago (${numOnline} of ${this.userData.size} user(s) online)`);
        } else {
            const color = Q.COLORS[this.userData.size % Q.COLORS.length];
            const theta = Math.random() * 2 * Math.PI;
            const x = Q.INITIAL_PLACEMENT_RADIUS * Math.cos(theta);
            const z = Q.INITIAL_PLACEMENT_RADIUS * Math.sin(theta);
            const heading = (Math.PI / 2 - theta) * 180 / Math.PI;
            this.userData.set(id, {
                online: true,
                start: this.now(),
                color: color,
                position: {x, y: 0.8, z},
                rotation: {x: 0, y: heading, z: 0}
            });
            console.info(`RootModel: user ${color} ${id} joining (${numOnline} of ${this.userData.size} user(s) online)`);
        }
        this.publish(this.sessionId, 'user-added', id);
    }


    deleteUser(id) {
        const data = this.userData.get(id);
        data.online = false;   // retains data, including color & positions
        let numOnline = 0;
        for (const userDatum of this.userData.values()) { if (userDatum.online) { ++numOnline; } }
        const time = this.now() - this.userData.get(id)?.start;
        console.log(`user ${data?.color} ${id} left after ${time / 1000} seconds (${numOnline} of ${this.userData.size} user(s) online)`);
        this.publish(this.sessionId, 'user-exit', id);
        //this.publish(this.id, 'onDeleteUser', id);
    }

    onDeleteUser(id) {
        if (this.userData.get(id)) {
            this.userData.delete(id);
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
                console.log('RootView: Add multiuser component:', event.detail?.comp?.el?.id, event.detail);
                comp.ready = true;
                let elID = comp.el.id;
                self.publish(model.id, "add-multiuser-model", { elID: elID, rig: event.detail.rig });
            }
        });

        this.aframeScene.addEventListener('deleteComponent', function (event) {

            let data = event.detail.data;
            console.log('Delete multiuser component from scene: ', data);
            self.removeChild(data);
            self.publish(model.id, 'delete-multiuser-model', data);

        })

        this.subscribe(this.sessionId, 'user-added', this.onUserAdded);
        this.subscribe(this.sessionId, 'user-exit', this.onUserExit);
        this.subscribe(model.id, 'component-added', this.addViewComponent);
        this.subscribe(this.viewId, "synced", this.synced);

        for (const [id, data] of model.userData.entries()) {
            if (data?.online) {
                this.createAvatar(id, data);
            } else {
                this.removeAvatar(id, data);
            }
        }
    }

    addViewComponent(elID) {

        if (!Object.keys(this.children).includes(elID)) {
            let component = this.sceneModel.children.get(elID);
            let componentView = new ComponentView(component);
            this.children[elID] = componentView;
            console.log('RootView: View component added:', elID, component);
        }
    }

    synced() {
        console.log('RootView: synced models: ', this.sceneModel.children);
        for (const el of this.sceneModel.children.keys()) {
            this.addViewComponent(el);
        }
    }

    onUserAdded(id) {
        const data = this.sceneModel.userData.get(id);
        if (data) {
            this.createAvatar(id, data);
        } else {
            console.error(`RootView: can't create avatar for user ${id} without data`);
        }
        //console.log('Models: ', this.children);
    }

    onUserExit(id) {
        const data = this.sceneModel.userData.get(id);
        this.removeAvatar(id, data);
    }

    createAvatar(id, data) {
        if (id === this.viewId) {   // the local user
            let rigEntity = document.getElementById(Q.AVATAR_PREFIX + id);
            if (rigEntity) {
                console.log(`RootView: rig for user ${data.color} ${id} already exists as ${Q.AVATAR_PREFIX + id}`);
            } else {
                rigEntity = document.getElementById(Q.RIG_ID);
                console.log(`RootView: setting ID of rig for user ${data.color} ${id} to ${Q.AVATAR_PREFIX + id}`);
                rigEntity.setAttribute('id', Q.AVATAR_PREFIX + id);
                rigEntity.setAttribute('position', data.position);
                rigEntity.setAttribute('rotation', data.rotation);
                rigEntity.setAttribute('multiuser', {rig: true});
            }
        } else {
            let avatarEntity = document.getElementById(Q.AVATAR_PREFIX + id);
            if (avatarEntity) {
                console.log(`RootView: avatar of user ${data.color} ${id} already exists`);
            } else {
                console.log(`RootView: creating avatar for user ${data.color} ${id}`);
                const avatarTemplate = document.getElementById('avatarTemplate');
                avatarEntity = avatarTemplate ?
                    avatarTemplate.content.firstElementChild.cloneNode(true) :
                    document.createElement('a-box');
                avatarEntity.setAttribute('id', Q.AVATAR_PREFIX + id);
                avatarEntity.setAttribute('position', data.position);
                avatarEntity.setAttribute('rotation', data.rotation);
                avatarEntity.setAttribute('color', data.color);
                avatarEntity.setAttribute('multiuser', {rig: true});
                AFRAME.scenes[0].appendChild(avatarEntity);
            }
        }
    }

    removeAvatar(id, data) {
        const avatarEntity = document.getElementById(Q.AVATAR_PREFIX + id);
        if (avatarEntity) {
            const avatarColor = avatarEntity?.getAttribute('color');
            console.log(`RootView: removing ${avatarColor} avatar of user ${data?.color} ${id}`);
            avatarEntity.parentNode.removeChild(avatarEntity);
        } else {
            console.warn(`RootView: can't remove non-existent avatar for user ${data?.color} ${id}`);
        }
    }
    removeChild(childID) {
        const child = this.children[childID];
        child.detach();
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

        this.components = {
            multiuser: {
                rig:  options.rig,
                anim: false
            }
        };

        this.elID = options.elID;
        this.rig = options.rig;
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
        Object.assign(target || {}, source)
        return target
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

        let self = this;
        this.elementModel = model;
        this.aframeScene = document.querySelector('a-scene');
        this.aframeEl = this.aframeScene.querySelector('#' + this.elementModel.elID);

        this.aframeEl?.addEventListener('setAttribute-event', function (event) {

            let data = event.detail.data;
            if (!self.elementModel.rig || ['position', 'rotation', 'scale', 'multiuser'].includes(data.attrName)) {
                //console.log('ComponentView: Get AFrame setAttribute event with: ', data);
                self.publish(self.elementModel.id, 'changeComponent', { data: { [data.attrName]: data.value }, senderId: self.viewId });
            }
        })

        this.subscribe(model.id, { event: 'modelChanged', handling: 'oncePerFrame' }, this.changeView);
        this.subscribe(this.viewId, "synced", this.initView);
        //this.initView();

    }

    initView() {
        console.log('ComponentView: init view from model:', this.elementModel?.elID);

        let modelComponents = this.elementModel.components;

        if (Object.entries(modelComponents).length > 1) {
            // set from model components
            this.aframeEl?.emit('update-aframe-element', { data: modelComponents });
        } else {
            //set up first model from aframe components
            let newModelComponents = {};
            let elementComponents = this.aframeEl?.components;

            Object.keys(elementComponents).forEach(key => {
                if (!this.elementModel.rig || ['position', 'rotation', 'scale', 'multiuser'].includes(key)) {
                    let prop = this.aframeEl?.getAttribute(key);
                    newModelComponents[key] = JSON.parse(JSON.stringify(prop));
                }
            })
            this.publish(this.elementModel.id, 'changeComponent', { data: newModelComponents, senderId: this.viewId });
        }
    }

    changeView(changed) {
        this.aframeEl.emit('update-aframe-element', { data: changed.data });
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
        rig:  { type: 'boolean', default: false },
        anim: { type: 'boolean', default: false }
    },

    init: function () {
        let self = this;
        this.scene = this.el.sceneEl;
        this.ready = false;

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

            let data = event.detail.data;
            Object.keys(data).forEach(key => {
                self.el.setAttributeAFrame(key, data[key]);
                //console.log('multiuser component: Set attribute on element from model: ', key, ' with: ', data[key])
            })
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
            //this.updateComponent(attrName, newAttrValue, clobber);
            //console.log('multiuser component: Send attribute to model: ', attrName, newAttrValue, clobber);
            this.emit('setAttribute-event', { data: { attrName: attrName, value: newAttrValue, clobber: clobber } }, false);


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

    tick: function (t, dt) {

        if (!this.ready) {
            this.scene.emit('add-multiuser', { comp: this, rig: this.data.rig }, false);
        }

    }
})
