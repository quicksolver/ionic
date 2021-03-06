import { Component, Element, Event, EventEmitter, Prop, QueueApi } from '@stencil/core';

import { Gesture, GestureDetail, Mode, PickerColumn } from '../../interface';
import { hapticSelectionChanged } from '../../utils';
import { clamp } from '../../utils/helpers';

/** @hidden */
@Component({
  tag: 'ion-picker-column'
})
export class PickerColumnCmp {
  mode!: Mode;

  private bounceFrom!: number;
  private lastIndex?: number;
  private minY!: number;
  private maxY!: number;
  private optHeight = 0;
  private rotateFactor = 0;
  private scaleFactor = 1;
  private velocity = 0;
  private y = 0;
  private optsEl?: HTMLElement;
  private gesture?: Gesture;
  private rafId: any;

  @Element() el!: HTMLElement;

  @Prop({ context: 'queue' }) queue!: QueueApi;

  @Prop() col!: PickerColumn;

  @Event() ionChange!: EventEmitter<void>;

  componentWillLoad() {
    let pickerRotateFactor = 0;
    let pickerScaleFactor = 0.81;

    if (this.mode === 'ios') {
      pickerRotateFactor = -0.46;
      pickerScaleFactor = 1;
    }

    this.rotateFactor = pickerRotateFactor;
    this.scaleFactor = pickerScaleFactor;
  }

  async componentDidLoad() {
    // get the scrollable element within the column
    const colEl = this.optsEl!;

    // get the height of one option
    this.optHeight = (colEl.firstElementChild ? colEl.firstElementChild.clientHeight : 0);

    this.refresh();

    this.gesture = (await import('../../utils/gesture/gesture')).createGesture({
      el: this.el,
      queue: this.queue,
      gestureName: 'picker-swipe',
      gesturePriority: 10,
      threshold: 0,
      onStart: this.onDragStart.bind(this),
      onMove: this.onDragMove.bind(this),
      onEnd: this.onDragEnd.bind(this),
    });
    this.gesture.setDisabled(false);
  }

  private setSelected(selectedIndex: number, duration: number) {
    // if there is a selected index, then figure out it's y position
    // if there isn't a selected index, then just use the top y position
    const y = (selectedIndex > -1) ? -(selectedIndex * this.optHeight) : 0;

    this.velocity = 0;

    // set what y position we're at
    cancelAnimationFrame(this.rafId);
    this.update(y, duration, true);
    this.ionChange.emit();
  }

  private update(y: number, duration: number, saveY: boolean) {
    // ensure we've got a good round number :)
    let translateY = 0;
    let translateZ = 0;
    const { col, rotateFactor } = this;
    const selectedIndex = col.selectedIndex = this.indexForY(-y);
    const durationStr = (duration === 0) ? null : duration + 'ms';
    const scaleStr = `scale(${this.scaleFactor})`;

    const children = this.optsEl!.children;
    for (let i = 0; i < children.length; i++) {
      const button = children[i] as HTMLElement;
      const opt = col.options[i];
      const optOffset = (i * this.optHeight) + y;
      let visible = true;
      let transform = '';

      if (rotateFactor !== 0) {
        const rotateX = optOffset * rotateFactor;
        if (Math.abs(rotateX) > 90) {
          visible = false;
        } else {
          translateY = 0;
          translateZ = 90;
          transform = `rotateX(${rotateX}deg) `;
        }
      } else {
        translateZ = 0;
        translateY = optOffset;
        if (Math.abs(translateY) > 170) {
          visible = false;
        }
      }

      const selected = selectedIndex === i;
      if (visible) {
        transform += `translate3d(0px,${translateY}px,${translateZ}px) `;
        if (this.scaleFactor !== 1 && !selected) {
          transform += scaleStr;
        }
      } else {
        transform = 'translate3d(-9999px,0px,0px)';
      }
      // Update transition duration
      if (duration !== opt.duration) {
        opt.duration = duration;
        button.style.transitionDuration = durationStr;
      }
      // Update transform
      if (transform !== opt.transform) {
        opt.transform = transform;
        button.style.transform = transform;
      }
      // Update selected item
      if (selected !== opt.selected) {
        opt.selected = selected;
        if (selected) {
          button.classList.add(PICKER_OPT_SELECTED);
        } else {
          button.classList.remove(PICKER_OPT_SELECTED);
        }
      }
    }
    this.col.prevSelected = selectedIndex;

    if (saveY) {
      this.y = y;
    }

    if (this.lastIndex !== selectedIndex) {
      // have not set a last index yet
      hapticSelectionChanged();
      this.lastIndex = selectedIndex;
    }
  }

  private decelerate() {
    if (this.velocity !== 0) {
      // still decelerating
      this.velocity *= DECELERATION_FRICTION;

      // do not let it go slower than a velocity of 1
      this.velocity = (this.velocity > 0)
        ? Math.max(this.velocity, 1)
        : Math.min(this.velocity, -1);

      let y = this.y + this.velocity;

      if (y > this.minY) {
        // whoops, it's trying to scroll up farther than the options we have!
        y = this.minY;
        this.velocity = 0;

      } else if (y < this.maxY) {
        // gahh, it's trying to scroll down farther than we can!
        y = this.maxY;
        this.velocity = 0;
      }

      this.update(y, 0, true);
      const notLockedIn = (Math.round(y) % this.optHeight !== 0) || (Math.abs(this.velocity) > 1);
      if (notLockedIn) {
        // isn't locked in yet, keep decelerating until it is
        this.rafId = requestAnimationFrame(() => this.decelerate());
      } else {
        this.ionChange.emit();
      }

    } else if (this.y % this.optHeight !== 0) {
      // needs to still get locked into a position so options line up
      const currentPos = Math.abs(this.y % this.optHeight);

      // create a velocity in the direction it needs to scroll
      this.velocity = (currentPos > (this.optHeight / 2) ? 1 : -1);

      this.decelerate();
    }
  }

  private indexForY(y: number) {
    return Math.min(Math.max(Math.abs(Math.round(y / this.optHeight)), 0), this.col.options.length - 1);
  }

  // TODO should this check disabled?

  private onDragStart(detail: GestureDetail) {
    // We have to prevent default in order to block scrolling under the picker
    // but we DO NOT have to stop propagation, since we still want
    // some "click" events to capture
    if (detail.event) {
      detail.event.preventDefault();
      detail.event.stopPropagation();
    }

    // reset everything
    cancelAnimationFrame(this.rafId);
    const options = this.col.options;
    let minY = (options.length - 1);
    let maxY = 0;
    for (let i = 0; i < options.length; i++) {
      if (!options[i].disabled) {
        minY = Math.min(minY, i);
        maxY = Math.max(maxY, i);
      }
    }

    this.minY = -(minY * this.optHeight);
    this.maxY = -(maxY * this.optHeight);
  }

  private onDragMove(detail: GestureDetail) {
    if (detail.event) {
      detail.event.preventDefault();
      detail.event.stopPropagation();
    }

    // update the scroll position relative to pointer start position
    let y = this.y + detail.deltaY;

    if (y > this.minY) {
      // scrolling up higher than scroll area
      y = Math.pow(y, 0.8);
      this.bounceFrom = y;

    } else if (y < this.maxY) {
      // scrolling down below scroll area
      y += Math.pow(this.maxY - y, 0.9);
      this.bounceFrom = y;

    } else {
      this.bounceFrom = 0;
    }

    this.update(y, 0, false);
  }

  private onDragEnd(detail: GestureDetail) {
    if (this.bounceFrom > 0) {
      // bounce back up
      this.update(this.minY, 100, true);
      return;
    } else if (this.bounceFrom < 0) {
      // bounce back down
      this.update(this.maxY, 100, true);
      return;
    }

    this.velocity = clamp(-MAX_PICKER_SPEED, detail.velocityY * 17, MAX_PICKER_SPEED);
    if (this.velocity === 0 && detail.deltaY === 0) {
      const opt = (detail.event.target as Element).closest('.picker-opt');
      if (opt && opt.hasAttribute('opt-index')) {
        this.setSelected(parseInt(opt.getAttribute('opt-index')!, 10), 150);
      }

    } else {
      this.y += detail.deltaY;
      this.decelerate();
    }
  }

  private refresh() {
    let min = this.col.options.length - 1;
    let max = 0;
    const options = this.col.options;
    for (let i = 0; i < options.length; i++) {
      if (!options[i].disabled) {
        min = Math.min(min, i);
        max = Math.max(max, i);
      }
    }

    const selectedIndex = clamp(min, this.col.selectedIndex!, max);
    if (this.col.prevSelected !== selectedIndex) {
      const y = (selectedIndex * this.optHeight) * -1;
      this.velocity = 0;
      this.update(y, 150, true);
    }
  }

  hostData() {
    return {
      class: {
        'picker-col': true,
        'picker-opts-left': this.col.align === 'left',
        'picker-opts-right': this.col.align === 'right'
      },
      style: {
        'max-width': this.col.columnWidth
      }
    };
  }

  render() {
    const col = this.col;
    const Button = 'button' as any;
    return [
      col.prefix && (
        <div class="picker-prefix" style={{ width: col.prefixWidth! }}>
          {col.prefix}
        </div>
      ),
      <div
        class="picker-opts"
        style={{ maxWidth: col.optionsWidth! }}
        ref={ el => this.optsEl = el }>
        { col.options.map((o, index) =>
          <Button
            class={{ 'picker-opt': true, 'picker-opt-disabled': !!o.disabled }}
            disable-activated
            opt-index={index}>
            {o.text}
          </Button>
        )}
      </div>,
      col.suffix && (
        <div class="picker-suffix" style={{ width: col.suffixWidth! }}>
          {col.suffix}
        </div>
      )
    ];
  }
}

export const PICKER_OPT_SELECTED = 'picker-opt-selected';
export const DECELERATION_FRICTION = 0.97;
export const FRAME_MS = (1000 / 60);
export const MAX_PICKER_SPEED = 60;
