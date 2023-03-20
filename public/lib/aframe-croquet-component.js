/*
The MIT License (MIT) 
Copyright (c) 2020 Nikolai Suslov | Krestianstvo.org
*/

if (typeof AFRAME === 'undefined') {
    throw new Error('Component attempted to register before AFRAME was available.');
}

let Q = Croquet.Constants;
Q.STEP_MS = 1000 / 20;

class RootModel extends Croquet.Model {

    init(options) {
        super.init(options);
        this.children = {};
        //Aware of Users
        this.userData = {};
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

        let component = this.children[data];
        if (component) {
            component.destroy();
            delete this.children[data];
        }

    }

    onComponentAdd(data) {

        let elID = data.elID;

        if (!Object.keys(this.children).includes(elID)) {
            let component = ComponentModel.create(data);
            this.children[elID] = component;
            console.log("Model component added!");
        }
        this.publish(this.id, 'component-added', elID);
    }



    addUser(id) {
        this.userData[id] = { start: this.now() };
        console.log(`user ${id} came in`);
        this.publish(this.sessionId, 'user-added');
    }


    deleteUser(id) {
        const time = this.now() - this.userData[id].start;
        //console.log(`user ${id} left after ${time / 1000} seconds`);
        //this.publish(this.id, 'onDeleteUser', id);
    }

    onDeleteUser(id) {
        if (this.userData[id])
            delete this.userData[id];
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
                console.log('Add multiuser component', event.detail);
                comp.ready = true;
                let elID = comp.el.id;
                self.publish(model.id, "add-multiuser-model", { elID: elID });
            }
        });

        this.aframeScene.addEventListener('deleteComponent', function (event) {

            let data = event.detail.data;
            console.log('Delete multiuser component from scene: ', data);
            self.removeChild(data);
            self.publish(model.id, 'delete-multiuser-model', data);

        })

        this.subscribe(this.sessionId, 'user-added', this.onUserAdded);
        this.subscribe(model.id, 'component-added', this.addViewComponent);
        this.subscribe(this.viewId, "synced", this.synced);

    }

    addViewComponent(elID) {

        if (!Object.keys(this.children).includes(elID)) {
            let component = this.sceneModel.children[elID];
            let componentView = new ComponentView(component);
            this.children[elID] = componentView;
            console.log('View component added!');
        }
    }

    synced() {
        console.log('Synced Models: ', this.sceneModel.children);
        Object.keys(this.sceneModel.children).forEach(el=>{
            this.addViewComponent(el);
        })
    }

    onUserAdded() {
        console.log('User added!');
        //console.log('Models: ', this.children);
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
                anim: false
            }
        };

        this.elID = options.elID;
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
                    { x: rot.x, y: Math.sin(t) * 50, z: Math.sin(t) * 30 }
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
        //console.log('Model is changed with: ', diff, ' from ', changed.senderId);
    }
}


class ComponentView extends Croquet.View {

    constructor(model) {
        super(model);

        let self = this;
        this.elementModel = model;
        this.aframeScene = document.querySelector('a-scene');
        this.aframeEl = this.aframeScene.querySelector('#' + this.elementModel.elID);

        this.aframeEl.addEventListener('setAttribute-event', function (event) {

            let data = event.detail.data;
            //console.log('Get AFrame setAttribute event with: ', data);
            self.publish(self.elementModel.id, 'changeComponent', { data: { [data.attrName]: data.value }, senderId: self.viewId });

        })

        this.subscribe(model.id, { event: 'modelChanged', handling: 'oncePerFrame' }, this.changeView);
        this.subscribe(this.viewId, "synced", this.initView);
        //this.initView();

    }

    initView() {
        console.log('init view from model...');

        let modelComponents = this.elementModel.components;

        if (Object.entries(modelComponents).length > 1) {
            // set from model components
            this.aframeEl.emit('update-aframe-element', { data: modelComponents });
        } else {
            //set up first model from aframe components
            let newModelComponents = {};
            let elementComponents = this.aframeEl.components;

            Object.keys(elementComponents).forEach(key => {
                let prop = this.aframeEl.getAttribute(key);
                newModelComponents[key] = JSON.parse(JSON.stringify(prop));
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
        anim: { type: 'string', default: false }
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
                //console.log('Set attribute on element from model: ', key, ' with: ', data[key])
            })
        })
    },

    //Original defenition from A-Frame master
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

    //Modified defenition from A-Frame master
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
            //console.log('Send attribute to model: ', attrName, newAttrValue, clobber);
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
            this.scene.emit('add-multiuser', { comp: this }, false);
        }

    }
})