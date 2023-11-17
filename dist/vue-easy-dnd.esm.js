import { reactive, openBlock, createBlock, resolveDynamicComponent, normalizeClass, createSlots, withCtx, renderSlot, normalizeProps, guardReactiveProps, createElementBlock, createCommentVNode, renderList, TransitionGroup, h, nextTick } from 'vue';

function mitt(n){return {all:n=n||new Map,on:function(t,e){var i=n.get(t);i?i.push(e):n.set(t,[e]);},off:function(t,e){var i=n.get(t);i&&(e?i.splice(i.indexOf(e)>>>0,1):n.set(t,[]));},emit:function(t,e){var i=n.get(t);i&&i.slice().map(function(n){n(e);}),(i=n.get("*"))&&i.slice().map(function(n){n(t,e);});}}}

/**
 * This is the class of the global object that holds the state of the drag and drop during its progress. It emits events
 * reporting its state evolution during the progress of the drag and drop. Its data is reactive and listeners can be
 * attached to it using the method on.
 */
class DnD {

    inProgress = false;
    type = null;
    data = null;
    source = null;
    top = null;
    position = null;
    eventBus = mitt();
    success = null;

    startDrag (source, event, x, y, type, data) {
      this.type = type;
      this.data = data;
      this.source = source;
      this.position = { x, y };
      this.top = null;
      this.inProgress = true;
      this.emit(event, 'dragstart');
      this.emit(event, 'dragtopchanged', { previousTop: null });
    }

    resetVariables () {
      this.inProgress = false;
      this.data = null;
      this.source = null;
      this.position = null;
      this.success = null;
    }

    stopDrag (event) {
      this.success = this.top !== null && this.top['compatibleMode'] && this.top['dropAllowed'];
      if (this.top !== null) {
        this.emit(event, 'drop');
      }
      this.emit(event, 'dragend');
      this.resetVariables();
    }

    cancelDrag (event) {
      this.success = false;
      this.emit(event, 'dragend');
      this.resetVariables();
    }

    mouseMove (event, comp) {
      if (this.inProgress) {
        let prevent = false;
        const previousTop = this.top;
        if (comp === null) {
          // The mouse move event reached the top of the document without hitting a drop component.
          this.top = null;
          prevent = true;
        }
        else if (comp['isDropMask']) {
          // The mouse move event bubbled until it reached a drop mask.
          this.top = null;
          prevent = true;
        }
        else if (comp['candidate'](this.type, this.data, this.source)) {
          // The mouse move event bubbled until it reached a drop component that participates in the current drag operation.
          this.top = comp;
          prevent = true;
        }

        if (prevent) {
          // We prevent the mouse move event from bubbling further up the tree because it reached the foremost drop component and that component is all that matters.
          event.stopPropagation();
        }
        if (this.top !== previousTop) {
          this.emit(event.detail.native, 'dragtopchanged', { previousTop: previousTop });
        }
        this.position = {
          x: event.detail.x,
          y: event.detail.y
        };
        this.emit(event.detail.native, 'dragpositionchanged');
      }
    }

    emit (native, event, data = {}) {
      this.eventBus.emit(event, {
        type: this.type,
        data: this.data,
        top: this.top,
        source: this.source,
        position: this.position,
        success: this.success,
        native,
        ...data
      });
    }

    on (event, callback) {
      this.eventBus.on(event, callback);
    }

    off (event, callback) {
      this.eventBus.off(event, callback);
    }
}

const dnd = reactive(new DnD());

var DragAwareMixin = {
  data () {
    return {
      isDropMask: false
    };
  },
  computed: {
    dragInProgress () {
      return dnd.inProgress;
    },
    dragData () {
      return dnd.data;
    },
    dragType () {
      return dnd.type;
    },
    dragPosition () {
      return dnd.position;
    },
    dragSource () {
      return dnd.source;
    },
    dragTop () {
      return dnd.top;
    }
  }
};

/**
 * This files contains the primitives required to create drag images from HTML elements that serve as models. A snapshot
 * of the computed styles of the model elements is taken when creating the drag image, so that it will look the same as
 * the model, no matter where the drag images is grafted into the DOM.
 */

/**
 * Creates a drag image using the given element as model.
 */
function createDragImage (el) {
  const clone = deepClone(el);
  clone.style.position = 'fixed';
  clone.style.margin = '0';
  clone.style['z-index'] = '1000';
  clone.style.transition = 'opacity 0.2s';
  return clone;
}

/**
 * Clones the given element and all its descendants.
 */
function deepClone (el) {
  const clone = el.cloneNode(true);
  copyStyle(el, clone);
  const vSrcElements = el.getElementsByTagName('*');
  const vDstElements = clone.getElementsByTagName('*');
  for (let i = vSrcElements.length; i--;) {
    const vSrcElement = vSrcElements[i];
    const vDstElement = vDstElements[i];
    copyStyle(vSrcElement, vDstElement);
  }
  return clone;
}

/**
 * Copy the computed styles from src to destination.
 */
function copyStyle (src, destination) {
  const computedStyle = window.getComputedStyle(src);
  for (const key of computedStyle) {
    if (key === 'width') {
      // IE11
      const width = computedStyle.getPropertyValue('box-sizing') === 'border-box' ?
        src.clientWidth :
        src.clientWidth - parseFloat(computedStyle.paddingLeft) - parseFloat(computedStyle.paddingRight);
      destination.style.setProperty('width', width + 'px');
    }
    else if (key === 'height') {
      // IE11
      const height = computedStyle.getPropertyValue('box-sizing') === 'border-box' ?
        src.clientHeight :
        src.clientHeight - parseFloat(computedStyle.paddingTop) - parseFloat(computedStyle.paddingBottom);
      destination.style.setProperty('height', height + 'px');
    }
    else {
      destination.style.setProperty(key, computedStyle.getPropertyValue(key), computedStyle.getPropertyPriority(key));
    }
  }
  destination.style.pointerEvents = 'none';
}

// Forked from https://gist.github.com/gre/296291b8ce0d8fe6e1c3ea4f1d1c5c3b
const regex = /(auto|scroll)/;

const style = (node, prop) =>
  getComputedStyle(node, null).getPropertyValue(prop);

const scroll = (node) =>
  regex.test(
    style(node, 'overflow') +
    style(node, 'overflow-y') +
    style(node, 'overflow-x'));

const scrollparent = (node) =>
  !node || node===document.body
    ? document.body
    : scroll(node)
      ? node
      : scrollparent(node.parentNode);

// Forked from https://github.com/bennadel/JavaScript-Demos/blob/master/demos/window-edge-scrolling/index.htm
// Code was altered to work with scrollable containers

var timer = null;

function cancelScrollAction() {
  clearTimeout(timer);
}

function performEdgeScroll(
  event,
  container,
  clientX,
  clientY,
  edgeSize
) {
  if (!container || !edgeSize) {
    cancelScrollAction();
    return false;
  }

  // NOTE: Much of the information here, with regard to document dimensions,
  // viewport dimensions, and window scrolling is derived from JavaScript.info.
  // I am consuming it here primarily as NOTE TO SELF.
  // --
  // Read More: https://javascript.info/size-and-scroll-window
  // --
  // CAUTION: The viewport and document dimensions can all be CACHED and then
  // recalculated on window-resize events (for the most part). I am keeping it
  // all here in the mousemove event handler to remove as many of the moving
  // parts as possible and keep the demo as simple as possible.

  // Get the viewport-relative coordinates of the mousemove event.
  var rect = container.getBoundingClientRect();
  var isBody = container === document.body;

  var viewportX = clientX - rect.left;
  var viewportY = clientY - rect.top;
  if (isBody) {
    viewportX = clientX;
    viewportY = clientY;
  }

  // Get the viewport dimensions.
  var viewportWidth = rect.width;
  var viewportHeight = rect.height;
  if (isBody) {
    viewportWidth = document.documentElement.clientWidth;
    viewportHeight = document.documentElement.clientHeight;
  }

  // Next, we need to determine if the mouse is within the "edge" of the
  // viewport, which may require scrolling the window. To do this, we need to
  // calculate the boundaries of the edge in the viewport (these coordinates
  // are relative to the viewport grid system).
  var edgeTop = edgeSize;
  var edgeLeft = edgeSize;
  var edgeBottom = viewportHeight - edgeSize;
  var edgeRight = viewportWidth - edgeSize;

  var isInLeftEdge = viewportX < edgeLeft;
  var isInRightEdge = viewportX > edgeRight;
  var isInTopEdge = viewportY < edgeTop;
  var isInBottomEdge = viewportY > edgeBottom;

  // If the mouse is not in the viewport edge, there's no need to calculate
  // anything else.
  if (!(isInLeftEdge || isInRightEdge || isInTopEdge || isInBottomEdge)) {
    cancelScrollAction();
    return false;
  }

  // If we made it this far, the user's mouse is located within the edge of the
  // viewport. As such, we need to check to see if scrolling needs to be done.

  // Get the document dimensions.
  var documentWidth = Math.max(
    container.scrollWidth,
    container.offsetWidth,
    container.clientWidth
  );
  var documentHeight = Math.max(
    container.scrollHeight,
    container.offsetHeight,
    container.clientHeight
  );

  // Calculate the maximum scroll offset in each direction. Since you can only
  // scroll the overflow portion of the document, the maximum represents the
  // length of the document that is NOT in the viewport.
  var maxScrollX = documentWidth - viewportWidth;
  var maxScrollY = documentHeight - viewportHeight;

  // As we examine the mousemove event, we want to adjust the window scroll in
  // immediate response to the event; but, we also want to continue adjusting
  // the window scroll if the user rests their mouse in the edge boundary. To
  // do this, we'll invoke the adjustment logic immediately. Then, we'll setup
  // a timer that continues to invoke the adjustment logic while the window can
  // still be scrolled in a particular direction.
  (function checkForWindowScroll() {
    cancelScrollAction();

    if (adjustWindowScroll()) {
      timer = setTimeout(checkForWindowScroll, 5);
    }
  })();

  // Adjust the window scroll based on the user's mouse position. Returns True
  // or False depending on whether or not the window scroll was changed.
  function adjustWindowScroll() {
    // Get the current scroll position of the document.
    var currentScrollX = container.scrollLeft;
    var currentScrollY = container.scrollTop;
    if (isBody) {
      currentScrollX = window.pageXOffset;
      currentScrollY = window.pageYOffset;
    }

    // Determine if the window can be scrolled in any particular direction.
    var canScrollUp = currentScrollY > 0;
    var canScrollDown = currentScrollY < maxScrollY;
    var canScrollLeft = currentScrollX > 0;
    var canScrollRight = currentScrollX < maxScrollX;

    // Since we can potentially scroll in two directions at the same time,
    // let's keep track of the next scroll, starting with the current scroll.
    // Each of these values can then be adjusted independently in the logic
    // below.
    var nextScrollX = currentScrollX;
    var nextScrollY = currentScrollY;

    // As we examine the mouse position within the edge, we want to make the
    // incremental scroll changes more "intense" the closer that the user
    // gets the viewport edge. As such, we'll calculate the percentage that
    // the user has made it "through the edge" when calculating the delta.
    // Then, that use that percentage to back-off from the "max" step value.
    var maxStep = 10;

    // Should we scroll left?
    if (isInLeftEdge && canScrollLeft) {
      const intensity = (edgeLeft - viewportX) / edgeSize;
      nextScrollX = nextScrollX - maxStep * intensity;
    }
    // Should we scroll right?
    else if (isInRightEdge && canScrollRight) {
      const intensity = (viewportX - edgeRight) / edgeSize;
      nextScrollX = nextScrollX + maxStep * intensity;
    }

    // Should we scroll up?
    if (isInTopEdge && canScrollUp) {
      const intensity = (edgeTop - viewportY) / edgeSize;
      nextScrollY = nextScrollY - maxStep * intensity;
    }
    // Should we scroll down?
    else if (isInBottomEdge && canScrollDown) {
      const intensity = (viewportY - edgeBottom) / edgeSize;
      nextScrollY = nextScrollY + maxStep * intensity;
    }

    // Sanitize invalid maximums. An invalid scroll offset won't break the
    // subsequent .scrollTo() call; however, it will make it harder to
    // determine if the .scrollTo() method should have been called in the
    // first place.
    nextScrollX = Math.max(0, Math.min(maxScrollX, nextScrollX));
    nextScrollY = Math.max(0, Math.min(maxScrollY, nextScrollY));

    if (nextScrollX !== currentScrollX || nextScrollY !== currentScrollY) {
      (isBody ? window : container).scrollTo(nextScrollX, nextScrollY);
      return true;
    } else {
      return false;
    }
  }

  return true;
}

var DragMixin = {
  mixins: [DragAwareMixin],
  props: {
    type: {
      type: String,
      default: null
    },
    data: {
      default: null
    },
    dragImageOpacity: {
      type: Number,
      default: 0.7
    },
    disabled: {
      type: Boolean,
      default: false
    },
    goBack: {
      type: Boolean,
      default: false
    },
    handle: {
      type: String,
      default: null
    },
    delta: {
      type: Number,
      default: 0
    },
    delay: {
      type: Number,
      default: 0
    },
    dragClass: {
      type: String,
      default: null
    },
    vibration: {
      type: Number,
      default: 0
    },
    scrollingEdgeSize: {
      type: Number,
      default: 100
    }
  },
  emits: ['dragstart', 'dragend', 'cut', 'copy'],
  data () {
    return {
      dragInitialised: false,
      dragStarted: false,
      ignoreNextClick: false,
      initialUserSelect: null,
      downEvent: null,
      startPosition: null,
      delayTimer: null,
      scrollContainer: null
    };
  },
  computed: {
    cssClasses () {
      const clazz = {
        'dnd-drag': true
      };
      if (!this.disabled) {
        return {
          ...clazz,
          'drag-source': this.dragInProgress && this.dragSource === this,
          'drag-mode-copy': this.currentDropMode === 'copy',
          'drag-mode-cut': this.currentDropMode === 'cut',
          'drag-mode-reordering': this.currentDropMode === 'reordering',
          'drag-no-handle': !this.handle
        };
      }
      else {
        return clazz;
      }
    },
    currentDropMode () {
      if (this.dragInProgress && this.dragSource === this) {
        if (this.dragTop && this.dragTop['dropAllowed']) {
          if (this.dragTop['reordering']) {
            return 'reordering';
          }
          else {
            return this.dragTop['mode'];
          }
        }
        else {
          return null;
        }
      }
      else {
        return null;
      }
    }
  },
  methods: {
    onSelectStart (e) {
      e.stopPropagation();
      e.preventDefault();
    },
    performVibration () {
      // If browser can perform vibration and user has defined a vibration, perform it
      if (this.vibration > 0 && window.navigator && window.navigator.vibrate) {
        window.navigator.vibrate(this.vibration);
      }
    },
    onMouseDown (e) {
      let target = null;
      let goodButton = false;
      if (e.type === 'mousedown') {
        const mouse = e;
        target = e.target;
        goodButton = mouse.buttons === 1;
      }
      else {
        const touch = e;
        target = touch.touches[0].target;
        goodButton = true;
      }

      if (this.disabled || this.downEvent !== null || !goodButton) {
        return;
      }

      // Check that the target element is eligible for starting a drag
      // Includes checking against the handle selector
      //   or whether the element contains 'dnd-no-drag' class (which should disable dragging from that
      //   sub-element of a draggable parent)
      const goodTarget = !target.matches('.dnd-no-drag, .dnd-no-drag *') &&
              (
                !this.handle ||
                target.matches(this.handle + ', ' + this.handle + ' *')
              );

      if (!goodTarget) {
        return;
      }

      this.scrollContainer = scrollparent(target);
      this.initialUserSelect = document.body.style.userSelect;
      document.documentElement.style.userSelect = 'none'; // Permet au drag de se poursuivre normalement même
      // quand on quitte un élémént avec overflow: hidden.
      this.dragStarted = false;
      this.downEvent = e;
      if (this.downEvent.type === 'mousedown') {
        const mouse = e;
        this.startPosition = {
          x: mouse.clientX,
          y: mouse.clientY
        };
      }
      else {
        const touch = e;
        this.startPosition = {
          x: touch.touches[0].clientX,
          y: touch.touches[0].clientY
        };
      }

      if (this.delay) {
        this.dragInitialised = false;
        clearTimeout(this.delayTimer);
        this.delayTimer = setTimeout(() => {
          this.dragInitialised = true;
          this.performVibration();
        }, this.delay);
      }
      else {
        this.dragInitialised = true;
        this.performVibration();
      }

      document.addEventListener('click', this.onMouseClick, true);
      document.addEventListener('mouseup', this.onMouseUp);
      document.addEventListener('touchend', this.onMouseUp);
      document.addEventListener('selectstart', this.onSelectStart);
      document.addEventListener('keyup', this.onKeyUp);

      setTimeout(() => {
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('touchmove', this.onMouseMove, { passive: false });
        document.addEventListener('easy-dnd-move', this.onEasyDnDMove);
      }, 0);

      // Prevents event from bubbling to ancestor drag components and initiate several drags at the same time
      e.stopPropagation();
    },
    // Prevent the user from accidentally causing a click event
    // if they have just attempted a drag event
    onMouseClick (e) {
      if (this.ignoreNextClick) {
        e.preventDefault();
        e.stopPropagation && e.stopPropagation();
        e.stopImmediatePropagation && e.stopImmediatePropagation();
        this.ignoreNextClick = false;
        return false;
      }
    },
    onMouseMove (e) {
      // We ignore the mousemove event that follows touchend :
      if (this.downEvent === null) return;

      // On touch devices, we ignore fake mouse events and deal with touch events only.
      if (this.downEvent.type === 'touchstart' && e.type === 'mousemove') return;

      // Find out event target and pointer position :
      let target = null;
      let x = null;
      let y = null;
      if (e.type === 'touchmove') {
        const touch = e;
        x = touch.touches[0].clientX;
        y = touch.touches[0].clientY;
        target = document.elementFromPoint(x, y);
        if (!target) {
          // Mouse going off screen. Ignore event.
          return;
        }
      }
      else {
        const mouse = e;
        x = mouse.clientX;
        y = mouse.clientY;
        target = mouse.target;
      }

      // Distance between current event and start position :
      const dist = Math.sqrt(Math.pow(this.startPosition.x - x, 2) + Math.pow(this.startPosition.y - y, 2));

      // If the drag has not begun yet and distance from initial point is greater than delta, we start the drag :
      if (!this.dragStarted && dist > this.delta) {
        // If they have dragged greater than the delta before the delay period has ended,
        // It means that they attempted to perform another action (such as scrolling) on the page
        if (!this.dragInitialised) {
          clearTimeout(this.delayTimer);
        }
        else {
          this.ignoreNextClick = true;
          this.dragStarted = true;
          dnd.startDrag(this, this.downEvent, this.startPosition.x, this.startPosition.y, this.type, this.data);
          document.documentElement.classList.add('drag-in-progress');
        }
      }

      // Dispatch custom easy-dnd-move event :
      if (this.dragStarted) {
        // If cursor/touch is at edge of container, perform scroll if available
        // If this.dragTop is defined, it means they are dragging on top of another DropList/EasyDnd component
        // if dropTop is a DropList, use the scrollingEdgeSize of that container if it exists, otherwise use the scrollingEdgeSize of the Drag component
        const currEdgeSize = this.dragTop && this.dragTop.$props.scrollingEdgeSize !== undefined ?
          this.dragTop.$props.scrollingEdgeSize :
          this.scrollingEdgeSize;

        if (currEdgeSize) {
          const currScrollContainer = this.dragTop ? scrollparent(this.dragTop.$el) : this.scrollContainer;
          performEdgeScroll(e, currScrollContainer, x, y, currEdgeSize);
        }
        else {
          cancelScrollAction();
        }

        const custom = new CustomEvent('easy-dnd-move', {
          bubbles: true,
          cancelable: true,
          detail: {
            x,
            y,
            native: e
          }
        });
        target.dispatchEvent(custom);
      }

      // Prevent scroll on touch devices if they were performing a drag
      if (this.dragInitialised && e.cancelable) {
        e.preventDefault();
      }
    },
    onEasyDnDMove (e) {
      dnd.mouseMove(e, null);
    },
    onMouseUp (e) {
      // On touch devices, we ignore fake mouse events and deal with touch events only.
      if (this.downEvent.type === 'touchstart' && e.type === 'mouseup') return;

      // This delay makes sure that when the click event that results from the mouseup is produced, the drag is
      // still in progress. So by checking the flag dnd.inProgress, one can tell apart true clicks from drag and
      // drop artefacts.
      setTimeout(() => {
        this.cancelDragActions();

        if (this.dragStarted) {
          dnd.stopDrag(e);
        }
        this.finishDrag();
      }, 0);
    },
    onKeyUp (e) {
      // If ESC is pressed, cancel the drag
      if (e.key === 'Escape') {
        this.cancelDragActions();

        setTimeout(() => {
          dnd.cancelDrag(e);
          this.finishDrag();
        }, 0);
      }
    },
    cancelDragActions () {
      this.dragInitialised = false;
      clearTimeout(this.delayTimer);
      cancelScrollAction();
    },
    finishDrag () {
      this.downEvent = null;
      this.scrollContainer = null;

      if (this.dragStarted) {
        document.documentElement.classList.remove('drag-in-progress');
      }
      document.removeEventListener('click', this.onMouseClick, true);
      document.removeEventListener('mousemove', this.onMouseMove);
      document.removeEventListener('touchmove', this.onMouseMove);
      document.removeEventListener('easy-dnd-move', this.onEasyDnDMove);
      document.removeEventListener('mouseup', this.onMouseUp);
      document.removeEventListener('touchend', this.onMouseUp);
      document.removeEventListener('selectstart', this.onSelectStart);
      document.removeEventListener('keyup', this.onKeyUp);
      document.documentElement.style.userSelect = this.initialUserSelect;
    },
    dndDragStart (ev) {
      if (ev.source === this) {
        this.$emit('dragstart', ev);
      }
    },
    dndDragEnd (ev) {
      if (ev.source === this) {
        this.$emit('dragend', ev);
      }
    },
    createDragImage (selfTransform) {
      let image;
      if (this.$slots['drag-image']) {
        const el = this.$refs['drag-image'] || document.createElement('div');
        if (el.childElementCount !== 1) {
          image = createDragImage(el);
        }
        else {
          image = createDragImage(el.children.item(0));
        }
      }
      else {
        image = createDragImage(this.$el);
        image.style.transform = selfTransform;
      }

      if (this.dragClass) {
        image.classList.add(this.dragClass);
      }
      image.classList.add('dnd-ghost');
      image['__opacity'] = this.dragImageOpacity;
      return image;
    }
  },
  created () {
    dnd.on('dragstart', this.dndDragStart);
    dnd.on('dragend', this.dndDragEnd);
  },
  mounted () {
    this.$el.addEventListener('mousedown', this.onMouseDown);
    this.$el.addEventListener('touchstart', this.onMouseDown);
  },
  beforeUnmount () {
    dnd.off('dragstart', this.dndDragStart);
    dnd.off('dragend', this.dndDragEnd);

    this.$el.removeEventListener('mousedown', this.onMouseDown);
    this.$el.removeEventListener('touchstart', this.onMouseDown);
  }
};

var script$4 = {
  name: 'Drag',
  mixins: [DragMixin],
  props: {
    /**
     * Tag to be used as root of this component. Defaults to div.
     */
    tag: {
      type: [String, Object, Function],
      default: 'div'
    }
  },
  computed: {
    dynamicSlots () {
      return Object.entries(this.$slots).filter(([key]) => key !== 'drag-image' && key !== 'default');
    }
  }
};

const _hoisted_1$2 = {
  key: 0,
  ref: "drag-image",
  class: "__drag-image"
};

function render$3(_ctx, _cache, $props, $setup, $data, $options) {
  return (openBlock(), createBlock(resolveDynamicComponent($props.tag), {
    class: normalizeClass(_ctx.cssClasses)
  }, createSlots({
    default: withCtx(() => [
      renderSlot(_ctx.$slots, "default", normalizeProps(guardReactiveProps(_ctx.$slots['default'] || {}))),
      (_ctx.dragInitialised)
        ? (openBlock(), createElementBlock("div", _hoisted_1$2, [
            renderSlot(_ctx.$slots, "drag-image")
          ], 512 /* NEED_PATCH */))
        : createCommentVNode("v-if", true)
    ]),
    _: 2 /* DYNAMIC */
  }, [
    renderList($options.dynamicSlots, ([slot, args]) => {
      return {
        name: slot,
        fn: withCtx(() => [
          renderSlot(_ctx.$slots, slot, normalizeProps(guardReactiveProps(args)))
        ])
      }
    })
  ]), 1032 /* PROPS, DYNAMIC_SLOTS */, ["class"]))
}

script$4.render = render$3;
script$4.__scopeId = "data-v-36828a08";

function dropAllowed (inst) {
  if (inst.dragInProgress && inst.typeAllowed) {
    return inst.compatibleMode && inst.effectiveAcceptsData(inst.dragData, inst.dragType);
  }
  return null;
}

function doDrop (inst, event) {
  inst.$emit('drop', event);
  event.source.$emit(inst.mode, event);
}

function candidate (inst, type) {
  return inst.effectiveAcceptsType(type);
}

var DropMixin = {
  mixins: [DragAwareMixin],
  props: {
    acceptsType: {
      type: [String, Array, Function],
      default: null
    },
    acceptsData: {
      type: Function,
      default: () => {
        return true;
      }
    },
    mode: {
      type: String,
      default: 'copy'
    },
    dragImageOpacity: {
      type: Number,
      default: 0.7
    }
  },
  emits: ['dragover', 'dragenter', 'dragleave', 'dragend', 'drop'],
  data () {
    return {
      isDrop: true
    };
  },
  computed: {
    compatibleMode () {
      return this.dragInProgress ? true : null;
    },
    dropIn () {
      if (this.dragInProgress) {
        return this.dragTop === this;
      }
      return null;
    },
    typeAllowed () {
      if (this.dragInProgress) {
        return this.effectiveAcceptsType(this.dragType);
      }
      return null;
    },
    dropAllowed () {
      return dropAllowed(this);
    },
    cssClasses () {
      const clazz = {
        'dnd-drop': true
      };
      if (this.dropIn !== null) {
        clazz['drop-in'] = this.dropIn;
        clazz['drop-out'] = !this.dropIn;
      }
      if (this.typeAllowed !== null) {
        clazz['type-allowed'] = this.typeAllowed;
        clazz['type-forbidden'] = !this.typeAllowed;
      }
      if (this.dropAllowed !== null) {
        clazz['drop-allowed'] = this.dropAllowed;
        clazz['drop-forbidden'] = !this.dropAllowed;
      }
      return clazz;
    }
  },
  methods: {
    effectiveAcceptsType (type) {
      if (this.acceptsType === null) {
        return true;
      }
      else if (typeof (this.acceptsType) === 'string' || typeof(this.acceptsType) === 'number') {
        return this.acceptsType === type;
      }
      else if (typeof (this.acceptsType) === 'object' && Array.isArray(this.acceptsType)) {
        return this.acceptsType.includes(type);
      }
      else {
        return this.acceptsType(type);
      }
    },
    effectiveAcceptsData (data, type) {
      return this.acceptsData(data, type);
    },
    onDragPositionChanged (event) {
      if (this === event.top) {
        this.$emit('dragover', event);
      }
    },
    onDragTopChanged (event) {
      if (this === event.top) {
        this.$emit('dragenter', event);
      }
      if (this === event.previousTop) {
        this.$emit('dragleave', event);
      }
    },
    onDragEnd (event) {
      if (this === event.top) {
        this.$emit('dragend', event);
      }
    },
    onDrop (event) {
      if (this.dropIn && this.compatibleMode && this.dropAllowed) {
        this.doDrop(event);
      }
    },
    doDrop (event) {
      doDrop(this, event);
    },
    /**
         * Returns true if the current drop area participates in the current drag operation.
         */
    candidate (type) {
      return candidate(this, type);
    },
    createDragImage () {
      let image = 'source';
      if (this.$refs['drag-image']) {
        const el = this.$refs['drag-image'];
        if (el.childElementCount !== 1) {
          image = createDragImage(el);
        }
        else {
          image = createDragImage(el.children.item(0));
        }
        image['__opacity'] = this.dragImageOpacity;
        image.classList.add('dnd-ghost');
      }
      return image;
    },
    onDnDMove (e) {
      dnd.mouseMove(e, this);
    }
  },
  created () {
    dnd.on('dragpositionchanged', this.onDragPositionChanged);
    dnd.on('dragtopchanged', this.onDragTopChanged);
    dnd.on('drop', this.onDrop);
    dnd.on('dragend', this.onDragEnd);
  },
  mounted () {
    this.$el.addEventListener('easy-dnd-move', this.onDnDMove);
  },
  beforeUnmount () {
    this.$el.removeEventListener('easy-dnd-move', this.onDnDMove);

    dnd.off('dragpositionchanged', this.onDragPositionChanged);
    dnd.off('dragtopchanged', this.onDragTopChanged);
    dnd.off('drop', this.onDrop);
    dnd.off('dragend', this.onDragEnd);
  }
};

var script$3 = {
  name: 'Drop',
  mixins: [DropMixin],
  props: {
    tag: {
      type: [String, Object, Function],
      default: 'div'
    }
  },
  computed: {
    dynamicSlots () {
      return Object.entries(this.$slots).filter(([key]) => key !== 'drag-image' && key !== 'default');
    },
    showDragImage () {
      return this.dragInProgress && this.typeAllowed && !!this.$slots['drag-image'];
    }
  }
};

const _hoisted_1$1 = {
  key: 0,
  ref: "drag-image",
  class: "__drag-image"
};

function render$2(_ctx, _cache, $props, $setup, $data, $options) {
  return (openBlock(), createBlock(resolveDynamicComponent($props.tag), {
    class: normalizeClass(_ctx.cssClasses)
  }, createSlots({
    default: withCtx(() => [
      renderSlot(_ctx.$slots, "default", normalizeProps(guardReactiveProps(_ctx.$slots['default'] || {}))),
      ($options.showDragImage)
        ? (openBlock(), createElementBlock("div", _hoisted_1$1, [
            renderSlot(_ctx.$slots, "drag-image", {
              type: _ctx.dragType,
              data: _ctx.dragData
            })
          ], 512 /* NEED_PATCH */))
        : createCommentVNode("v-if", true)
    ]),
    _: 2 /* DYNAMIC */
  }, [
    renderList($options.dynamicSlots, ([slot, args]) => {
      return {
        name: slot,
        fn: withCtx(() => [
          renderSlot(_ctx.$slots, slot, normalizeProps(guardReactiveProps(args)))
        ])
      }
    })
  ]), 1032 /* PROPS, DYNAMIC_SLOTS */, ["class"]))
}

script$3.render = render$2;
script$3.__scopeId = "data-v-01f6c2c0";

var script$2 = {
  name: 'DropMask',
  mixins: [DragAwareMixin],
  props: {
    tag: {
      type: [String, Object, Function],
      default: 'div'
    }
  },
  data () {
    return {
      isDropMask: true
    };
  },
  mounted () {
    this.$el.addEventListener('easy-dnd-move', this.onDndMove);
  },
  beforeUnmount () {
    this.$el.removeEventListener('easy-dnd-move', this.onDndMove);
  },
  methods: {
    createDragImage () {
      return 'source';
    },
    onDndMove (e) {
      dnd.mouseMove(e, this);
    }
  }
};

function render$1(_ctx, _cache, $props, $setup, $data, $options) {
  return (openBlock(), createBlock(resolveDynamicComponent($props.tag), null, createSlots({ _: 2 /* DYNAMIC */ }, [
    renderList(_ctx.$slots, (args, slot) => {
      return {
        name: slot,
        fn: withCtx(() => [
          renderSlot(_ctx.$slots, slot, normalizeProps(guardReactiveProps(args)))
        ])
      }
    })
  ]), 1024 /* DYNAMIC_SLOTS */))
}

script$2.render = render$1;

var script$1 = {
  name: 'DragFeedback'
};

const _hoisted_1 = { class: "DragFeedback" };

function render(_ctx, _cache, $props, $setup, $data, $options) {
  return (openBlock(), createElementBlock("div", _hoisted_1, [
    renderSlot(_ctx.$slots, "default")
  ]))
}

script$1.render = render;

class Grid {
    reference;
    referenceOriginalPosition;
    magnets = [];

    constructor (collection, upToIndex, direction, fromIndex) {
      this.reference = collection.item(0).parentNode;
      this.referenceOriginalPosition = {
        x: this.reference.getBoundingClientRect().left - this.reference.scrollLeft,
        y: this.reference.getBoundingClientRect().top - this.reference.scrollTop,
      };
      let index = 0;
      for (const child of collection) {
        if (index > upToIndex) break;
        const rect = child.getBoundingClientRect();
        const hasNestedDrop = child.classList.contains('dnd-drop') || child.getElementsByClassName('dnd-drop').length > 0;
        let horizontal = false;
        if (hasNestedDrop) {
          if (direction === 'auto') {
            // Auto mode not supported for now. Row or column must be defined explicitly if there are nested drop lists.
            throw 'Easy-DnD error : a drop list is missing one of these attributes : \'row\' or \'column\'.';
          }
          else {
            horizontal = direction === 'row';
          }
        }
        if (fromIndex === null) {
          // Inserting mode.
          this.magnets.push(hasNestedDrop ? this.before(rect, horizontal) : this.center(rect));
        }
        else {
          // Reordering mode.
          this.magnets.push(hasNestedDrop ? (
            fromIndex < index ? this.after : this.before
          )(rect, horizontal) : this.center(rect));
        }
        // Debug : show magnets :
        //document.body.insertAdjacentHTML("beforeend", "<div style='background-color: red; position: fixed; width: 1px; height: 1px; top:" + this.magnets[index].y + "px; left:" + this.magnets[index].x + "px;' ></div>")
        index++;
      }
    }

    /**
     * Returns the center of the rectangle.
     */
    center (rect) {
      return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2
      };
    }

    /**
     * When horizontal is true / false, returns middle of the left / top side of the rectangle.
     */
    before (rect, horizontal) {
      return horizontal ? {
        x: rect.left,
        y: rect.top + rect.height / 2
      } : {
        x: rect.left + rect.width / 2,
        y: rect.top
      };
    }

    /**
     * When horizontal is true / false, returns middle of the right / bottom side of the rectangle.
     */
    after (rect, horizontal) {
      return horizontal ? {
        x: rect.left + rect.width,
        y: rect.top + rect.height / 2
      } : {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height
      };
    }

    /**
     * In case the user scrolls during the drag, the position of the magnets are not what they used to be when the drag
     * started. A correction must be applied that takes into account the amount of scroll. This correction is the
     * difference between the current position of the parent element and its position when the drag started.
     */
    correction () {
      return {
        x: this.reference.getBoundingClientRect().left  - this.reference.scrollLeft - this.referenceOriginalPosition.x,
        y: this.reference.getBoundingClientRect().top - this.reference.scrollTop - this.referenceOriginalPosition.y,
      };
    }

    closestIndex (position) {
      const x = position.x - this.correction().x;
      const y = position.y - this.correction().y;
      let minDist = 999999;
      let index = -1;
      for (let i = 0; i < this.magnets.length; i++) {
        const magnet = this.magnets[i];
        const dist = Math.sqrt(Math.pow(magnet.x - x, 2) + Math.pow(magnet.y - y, 2));
        if (dist < minDist) {
          minDist = dist;
          index = i;
        }
      }
      return index;
    }
}

class DnDEvent {
    type;
    data;
    top;
    previousTop;
    source;
    position;
    success;
    native;
}

class ReorderEvent {
    from;
    to;
    
    constructor (from, to) {
      this.from = from;
      this.to = to;
    }

    apply (array) {
      const temp = array[this.from];
      array.splice(this.from, 1);
      array.splice(this.to, 0, temp);
    }

}

class InsertEvent {
    type;
    data;
    index;
    
    constructor (type, data, index) {
      this.type = type;
      this.data = data;
      this.index = index;
    }
}

var script = {
  name: 'DropList',
  mixins: [DropMixin],
  props: {
    tag: {
      type: [String, Object, Function],
      default: 'div'
    },
    items: {
      type: Array,
      required: true
    },
    row: {
      type: Boolean,
      default: false
    },
    column: {
      type: Boolean,
      default: false
    },
    noAnimations: {
      type: Boolean,
      default: false
    },
    scrollingEdgeSize: {
      type: Number,
      default: undefined
    }
  },
  emits: ['reorder', 'insert'],
  data () {
    return {
      grid: null,
      forbiddenKeys: [],
      feedbackKey: null,
      fromIndex: null
    };
  },
  computed: {
    rootTag () {
      if (this.noAnimations) {
        return this.tag;
      }
      return TransitionGroup;
    },
    rootProps () {
      if (this.noAnimations) {
        return {};
      }

      return {
        tag: this.tag,
        css: false
      };
    },
    direction () {
      // todo - rewrite this logic
      if (this.row) return 'row';
      if (this.column) return 'column';
      return 'auto';
    },
    reordering () {
      if (dnd.inProgress) {
        return dnd.source.$el.parentElement === this.$el;
      }
      return null;
    },
    closestIndex () {
      if (this.grid) {
        return this.grid.closestIndex(dnd.position);
      }
      return null;
    },
    dropAllowed () {
      if (this.dragInProgress) {
        if (this.reordering) {
          return this.items.length > 1;
        }
        else {
          // todo - eventually refactor so that this isn't necessary
          if (!dropAllowed(this)) {
            return false;
          }

          if (this.forbiddenKeys !== null && this.feedbackKey !== null) {
            return !this.forbiddenKeys.includes(this.feedbackKey);
          }

          return true;
        }
      }

      return null;
    },
    itemsBeforeFeedback () {
      if (this.closestIndex === 0) {
        return [];
      }
      return this.items.slice(0, this.closestIndex);
    },
    itemsAfterFeedback () {
      if (this.closestIndex === this.items.length) {
        return [];
      }
      return this.items.slice(this.closestIndex);
    },
    itemsBeforeReorderingFeedback () {
      if (this.closestIndex <= this.fromIndex) {
        return this.items.slice(0, this.closestIndex);
      }
      return this.items.slice(0, this.closestIndex + 1);
    },
    itemsAfterReorderingFeedback () {
      if (this.closestIndex <= this.fromIndex) {
        return this.items.slice(this.closestIndex);
      }
      return this.items.slice(this.closestIndex + 1);
    },
    reorderedItems () {
      const toIndex = this.closestIndex;
      const reordered = [...this.items];
      const temp = reordered[this.fromIndex];

      reordered.splice(this.fromIndex, 1);
      reordered.splice(toIndex, 0, temp);
      return reordered;
    },
    clazz () {
      return {
        'drop-list': true,
        'reordering': this.reordering === true,
        'inserting': this.reordering === false,
        ...(this.reordering === false ? this.cssClasses : { 'dnd-drop': true })
      };
    },
    showDragFeedback () {
      return this.dragInProgress && this.typeAllowed && !this.reordering;
    },
    showInsertingDragImage () {
      return this.dragInProgress && this.typeAllowed && !this.reordering && !!this.$slots['drag-image'];
    },
    showReorderingDragImage () {
      return this.dragInProgress && this.reordering && !!this.$slots['reordering-drag-image'];
    },
    hasReorderingFeedback () {
      return !!this.$slots['reordering-feedback'];
    },
    hasEmptySlot () {
      return !!this.$slots['empty'];
    }
  },
  created () {
    dnd.on('dragstart', this.onDragStart);
    dnd.on('dragend', this.onDragEnd);
  },
  beforeUnmount () {
    dnd.off('dragstart', this.onDragStart);
    dnd.off('dragend', this.onDragEnd);
  },
  methods: {
    // Presence of feedback node in the DOM and of keys in the virtual DOM required => delayed until what
    // depends on drag data has been processed.
    refresh () {
      this.$nextTick(() => {
        this.grid = this.computeInsertingGrid();
        this.feedbackKey = this.computeFeedbackKey();
        this.forbiddenKeys = this.computeForbiddenKeys();
      });
    },
    onDragStart (event) {
      if (this.candidate(dnd.type)) {
        if (this.reordering) {
          this.fromIndex = Array.prototype.indexOf.call(event.source.$el.parentElement.children, event.source.$el);
          this.grid = this.computeReorderingGrid();
        }
        else {
          this.refresh();
        }
      }
    },
    onDragEnd () {
      this.fromIndex = null;
      this.feedbackKey = null;
      this.forbiddenKeys = null;
      this.grid = null;
    },
    doDrop (event) {
      if (this.reordering) {
        if (this.fromIndex !== this.closestIndex) {
          this.$emit('reorder', new ReorderEvent(
            this.fromIndex,
            this.closestIndex
          ));
        }
      }
      else {
        // todo - eventually remove the need for this
        doDrop(this, event);
        this.$emit('insert', new InsertEvent(
          event.type,
          event.data,
          this.closestIndex
        ));
      }
    },
    candidate (type) {
      return candidate(this, type) || this.reordering;
    },
    computeForbiddenKeys () {
      return (this.noAnimations ? [] : this.$refs.component.$slots['default']())
        .map(vn => vn.key)
        .filter(k => !!k && k !== 'drag-image' && k !== 'drag-feedback');
    },
    computeFeedbackKey () {
      return this.$refs['feedback']['$slots']['default']()[0]['key'];
    },
    computeInsertingGrid () {
      if (this.$refs.feedback.$el.children.length < 1) {
        return null;
      }

      const feedback = this.$refs.feedback.$el.children[0];
      const clone = feedback.cloneNode(true);
      const tg = this.$el;
      if (tg.children.length > this.items.length) {
        tg.insertBefore(clone, tg.children[this.items.length]);
      }
      else {
        tg.appendChild(clone);
      }
      const grid = new Grid(tg.children, this.items.length, this.direction, null);
      tg.removeChild(clone);
      return grid;
    },
    computeReorderingGrid () {
      return new Grid(this.$el.children, this.items.length - 1, this.direction, this.fromIndex);
    },
    createDragImage () {
      let image;
      if (this.$refs['drag-image']) {
        const el = this.$refs['drag-image'];
        let model;
        if (el.childElementCount !== 1) {
          model = el;
        }
        else {
          model = el.children.item(0);
        }
        const clone = model.cloneNode(true);
        const tg = this.$el;
        tg.appendChild(clone);
        image = createDragImage(clone);
        tg.removeChild(clone);
        image['__opacity'] = this.dragImageOpacity;
        image.classList.add('dnd-ghost');
      }
      else {
        image = 'source';
      }
      return image;
    }
  },
  render () {
    if (!this.$slots['item']) {
      throw 'The "Item" slot must be defined to use DropList';
    }

    if (!this.$slots['feedback']) {
      throw 'The "Feedback" slot must be defined to use DropList';
    }

    let defaultArr = [];
    if (this.dropIn && this.dropAllowed) {
      if (this.reordering) {
        if (this.hasReorderingFeedback) {
          const itemsReorderingBefore = this.itemsBeforeReorderingFeedback.map((item, index) => {
            return this.$slots['item']({
              item: item,
              index: index,
              reorder: false
            })[0];
          });
          if (itemsReorderingBefore.length > 0) {
            defaultArr = defaultArr.concat(itemsReorderingBefore);
          }

          defaultArr.push(this.$slots['reordering-feedback']({
            key: 'reordering-feedback',
            item: this.items[this.fromIndex]
          })[0]);

          const itemsReorderingAfter = this.itemsAfterReorderingFeedback.map((item, index) => {
            return this.$slots['item']({
              item: item,
              index: this.itemsBeforeReorderingFeedback.length + index,
              reorder: false
            })[0];
          });
          if (itemsReorderingAfter.length > 0) {
            defaultArr = defaultArr.concat(itemsReorderingAfter);
          }
        }
        else {
          const reorderedItems = this.reorderedItems.map((item, index) => {
            return this.$slots['item']({
              item: item,
              index: index,
              reorder: index === this.closestIndex
            })[0];
          });
          if (reorderedItems.length > 0) {
            defaultArr = defaultArr.concat(reorderedItems);
          }
        }
      }
      else {
        const itemsBefore = this.itemsBeforeFeedback.map((item, index) => {
          return this.$slots['item']({
            item: item,
            index: index,
            reorder: false
          })[0];
        });
        if (itemsBefore.length > 0) {
          defaultArr = defaultArr.concat(itemsBefore);
        }

        defaultArr.push(this.$slots['feedback']({
          key: 'drag-feedback',
          data: this.dragData,
          type: this.dragType
        })[0]);

        const itemsAfter = this.itemsAfterFeedback.map((item, index) => {
          return this.$slots['item']({
            item: item,
            index: this.itemsBeforeFeedback.length + index,
            reorder: false
          })[0];
        });
        if (itemsAfter.length > 0) {
          defaultArr = defaultArr.concat(itemsAfter);
        }
      }
    }
    else {
      const defaultItems = this.items.map((item, index) => {
        return this.$slots['item']({
          item: item,
          index: index,
          reorder: false
        })[0];
      });

      if (defaultItems.length > 0) {
        defaultArr = defaultArr.concat(defaultItems);
      }
      else if (this.hasEmptySlot) {
        defaultArr.push(this.$slots['empty']()[0]);
      }
    }

    if (this.showDragFeedback) {
      defaultArr.push(h(
        script$1,
        {
          class: '__feedback',
          ref: 'feedback',
          key: 'drag-feedback'
        },
        {
          default: () => this.$slots['feedback']({
            type: this.dragType,
            data: this.dragData
          })[0]
        }
      ));
    }

    if (this.showReorderingDragImage) {
      defaultArr.push(h(
        'div',
        {
          class: '__drag-image',
          ref: 'drag-image',
          key: 'reordering-drag-image'
        },
        {
          default: () => this.$slots['reordering-drag-image']({
            item: this.items[this.fromIndex]
          })[0]
        }
      ));
    }

    if (this.showInsertingDragImage) {
      defaultArr.push(h(
        'div',
        {
          class: '__drag-image',
          ref: 'drag-image',
          key: 'inserting-drag-image'
        },
        {
          default: () => this.$slots['drag-image']({
            type: this.dragType,
            data: this.dragData
          })[0]
        }
      ));
    }

    return h(
      this.rootTag,
      {
        ref: 'component',
        class: this.clazz,
        ...this.rootProps
      },
      {
        default: () => defaultArr
      }
    );
  }
};

script.__scopeId = "data-v-81374b54";

/**
 * This class reacts to drag events emitted by the dnd object to manage a sequence of drag images and fade from one to the
 * other as the drag progresses.
 */
class DragImagesManager {

    selfTransform = null;
    clones = null;
    source = null;
    sourcePos = null;
    sourceClone = null;

    constructor () {
      dnd.on('dragstart', this.onDragStart.bind(this));
      dnd.on('dragtopchanged', this.onDragTopChanged.bind(this));
      dnd.on('dragpositionchanged', this.onDragPositionChanged.bind(this));
      dnd.on('dragend', this.onDragEnd.bind(this));
    }

    onDragStart (event) {
      // If go-back=true and it is still animating while they attempt another drag,
      //      it will bug out. Best to clean up any existing elements on the page before
      //      attempting to start the next animation
      this.cleanUp();

      this.sourcePos = {
        x: event.source.$el.getBoundingClientRect().left,
        y: event.source.$el.getBoundingClientRect().top
      };
      this.selfTransform = 'translate(-' + (event.position.x - this.sourcePos.x) + 'px, -' + (event.position.y - this.sourcePos.y) + 'px)';
      this.clones = new Map();
      this.source = event.source;
    }

    onDragEnd (event) {
      nextTick()
        .then(() => {
          if (!event.success && this.source && this.source['goBack']) {
            // Restore the drag image that is active when hovering outside any drop zone :
            const img = this.switch(null);
    
            // Move it back to its original place :
            window.requestAnimationFrame(() => {
              img.style.transition = 'all 0.5s';
              window.requestAnimationFrame(() => {
                img.style.left = this.sourcePos.x + 'px';
                img.style.top = this.sourcePos.y + 'px';
                img.style.transform = 'translate(0,0)';
                const handler = () => {
                  this.cleanUp();
                  img.removeEventListener('transitionend', handler);
                };
                img.addEventListener('transitionend', handler);
              });
            });
          }
          else {
            this.cleanUp();
          }
        });
    }

    cleanUp () {
      if (this.clones) {
        this.clones.forEach((clone) => {
          if (clone.parentNode === document.body) {
            document.body.removeChild(clone);
          }
        });
      }
      if (this.sourceClone !== null) {
        if (this.sourceClone.parentNode === document.body) {
          document.body.removeChild(this.sourceClone);
        }
      }
      this.selfTransform = null;
      this.clones = null;
      this.source = null;
      this.sourceClone = null;
      this.sourcePos = null;
    }

    onDragTopChanged (event) {
      this.switch(event.top);
    }

    switch (top) {
      this.clones.forEach(clone => {
        clone.style.opacity = '0';
      });
      if (this.sourceClone) {
        this.sourceClone.style.opacity = '0';
      }

      let activeClone;
      if (top === null) {
        activeClone = this.getSourceClone();
      }
      else {
        if (!this.clones.has(top)) {
          let clone = top['createDragImage'](this.selfTransform);
          if (clone === 'source') {
            clone = this.getSourceClone();
          }
          else if (clone !== null) {
            clone.style.opacity = '0';
            document.body.appendChild(clone);
          }
          this.clones.set(top, clone);
        }
        activeClone = this.clones.get(top);
      }

      if (activeClone !== null) {
        activeClone.offsetWidth; // Forces browser reflow
        activeClone.style.opacity = activeClone['__opacity'];
        activeClone.style.visibility = 'visible';
      }

      return activeClone;
    }

    getSourceClone () {
      if (this.sourceClone === null) {
        this.sourceClone = this.source['createDragImage'](this.selfTransform);
        this.sourceClone.style.opacity = '0';
        document.body.appendChild(this.sourceClone);
      }
      return this.sourceClone;
    }

    onDragPositionChanged () {
      this.clones.forEach((clone) => {
        clone.style.left = dnd.position.x + 'px';
        clone.style.top = dnd.position.y + 'px';
      });
      if (this.sourceClone) {
        this.sourceClone.style.left = dnd.position.x + 'px';
        this.sourceClone.style.top = dnd.position.y + 'px';
      }
    }

}

new DragImagesManager();

export { DnDEvent, script$4 as Drag, DragAwareMixin, script$1 as DragFeedback, DragImagesManager, DragMixin, script$3 as Drop, script as DropList, script$2 as DropMask, DropMixin, InsertEvent, ReorderEvent, createDragImage, dnd };
