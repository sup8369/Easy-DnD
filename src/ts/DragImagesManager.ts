import {Component, Vue} from "vue-property-decorator";
import {dnd} from "./DnD";

/**
 * This class reacts to drag events emitted by the dnd object to manage a sequence of drag images and fade from one to the
 * other as the drag progresses.
 */
@Component({}) // Necessary to set proper "this" context in event listeners.
export class DragImagesManager extends Vue {

    selfTransform: string = null;
    clones: Map<Vue, HTMLElement> = null;
    source: Vue = null;
    sourcePos: { x: number, y: number } = null;
    sourceClone: HTMLElement = null;

    constructor() {
        super();
        dnd.on('dragstart', this.onDragStart);
        dnd.on('dragtopchanged', this.onDragTopChanged);
        dnd.on('dragpositionchanged', this.onDragPositionChanged);
        dnd.on('dragend', this.onDragEnd);
    }

    onDragStart(event) {
        // If go-back=true and it is still animating while they attempt another drag,
        //      it will bug out. Best to clean up any existing elements on the page before
        //      attempting to start the next animation
        this.cleanUp();

        this.sourcePos = {
            x: event.source.$el.getBoundingClientRect().left,
            y: event.source.$el.getBoundingClientRect().top
        };
        this.selfTransform = "translate(-" + (event.position.x - this.sourcePos.x) + "px, -" + (event.position.y - this.sourcePos.y) + "px)";
        this.clones = new Map<Vue, HTMLElement>();
        this.source = event.source;
    }

    onDragEnd(event) {
        Vue.nextTick(() => {
            if (!event.success && this.source && this.source['goBack']) {
                // Restore the drag image that is active when hovering outside any drop zone :
                let img = this.switch(null) as HTMLElement;

                // Move it back to its original place :
                window.requestAnimationFrame(() => {
                    img.style.transition = "all 0.5s";
                    window.requestAnimationFrame(() => {
                        img.style.left = this.sourcePos.x + "px";
                        img.style.top = this.sourcePos.y + "px";
                        img.style.transform = "translate(0,0)";
                        let handler = () => {
                            this.cleanUp();
                            img.removeEventListener("transitionend", handler);
                        };
                        img.addEventListener("transitionend", handler);
                    })
                })
            } else {
                this.cleanUp();
            }
        });
    }

    cleanUp() {
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

    onDragTopChanged(event) {
        this.switch(event.top);
    }

    switch(top) {
        this.clones.forEach(clone => {
            clone.style.opacity = "0";
        });
        if (this.sourceClone) {
            this.sourceClone.style.opacity = "0";
        }

        let activeClone;
        if (top === null) {
            activeClone = this.getSourceClone();
        } else {
            if (!this.clones.has(top)) {
                let clone = top['createDragImage'](this.selfTransform);
                if (clone === 'source') {
                    clone = this.getSourceClone();
                } else if (clone !== null) {
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

    getSourceClone() {
        if (this.sourceClone === null) {
            this.sourceClone = this.source['createDragImage'](this.selfTransform);
            this.sourceClone.style.opacity = '0';
            document.body.appendChild(this.sourceClone);
        }
        return this.sourceClone;
    }

    onDragPositionChanged(event) {
        this.clones.forEach((clone) => {
            clone.style.left = dnd.position.x + "px";
            clone.style.top = dnd.position.y + "px";
        });
        if (this.sourceClone) {
            this.sourceClone.style.left = dnd.position.x + "px";
            this.sourceClone.style.top = dnd.position.y + "px";
        }
    }

}

new DragImagesManager();
