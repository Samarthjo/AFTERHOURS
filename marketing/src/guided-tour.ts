import './guided-tour.css';

export type GuideStage = 'waitlist' | 'logo' | 'core' | 'qr' | 'complete' | 'dismissed';

type GuidePlacement = 'above' | 'below' | 'left' | 'right';

interface GuideStep {
  target: HTMLElement;
  step: string;
  title: string;
  body: string;
  placement?: GuidePlacement;
  container?: HTMLElement;
  scrollIntoView?: boolean;
}

const GUIDE_STORAGE_KEY = 'afterhours.guide.v1';
const VALID_STAGES = new Set<GuideStage>(['waitlist', 'logo', 'core', 'qr', 'complete', 'dismissed']);

export function readGuideStage(): GuideStage | null {
  try {
    const value = window.sessionStorage.getItem(GUIDE_STORAGE_KEY);
    return value && VALID_STAGES.has(value as GuideStage) ? value as GuideStage : null;
  } catch {
    return null;
  }
}

export function writeGuideStage(stage: GuideStage): void {
  try {
    window.sessionStorage.setItem(GUIDE_STORAGE_KEY, stage);
  } catch {
    // The tour still works on the current page when storage is unavailable.
  }
}

export class GuidedTour {
  private readonly root: HTMLElement;
  private readonly stepLabel: HTMLElement;
  private readonly title: HTMLElement;
  private readonly body: HTMLElement;
  private readonly skip: HTMLButtonElement;
  private target: HTMLElement | null = null;
  private frame = 0;

  constructor(onDismiss: () => void) {
    this.root = document.createElement('aside');
    this.root.className = 'guided-hint';
    this.root.hidden = true;
    this.root.setAttribute('aria-live', 'polite');
    this.root.setAttribute('aria-atomic', 'true');

    const topLine = document.createElement('div');
    topLine.className = 'guided-hint__topline';
    this.stepLabel = document.createElement('span');
    this.skip = document.createElement('button');
    this.skip.type = 'button';
    this.skip.textContent = 'Skip guide';
    this.skip.addEventListener('click', () => {
      onDismiss();
      this.hide();
    });
    topLine.append(this.stepLabel, this.skip);

    this.title = document.createElement('strong');
    this.title.className = 'guided-hint__title';
    this.body = document.createElement('p');
    this.body.className = 'guided-hint__body';
    this.root.append(topLine, this.title, this.body);

    window.addEventListener('resize', this.queuePosition, { passive: true });
    window.addEventListener('scroll', this.queuePosition, { passive: true, capture: true });
  }

  show(step: GuideStep): void {
    this.clearTarget();
    this.target = step.target;
    this.target.classList.add('guided-target-active');
    this.stepLabel.textContent = step.step;
    this.title.textContent = step.title;
    this.body.textContent = step.body;
    this.root.dataset.preferredPlacement = step.placement || 'below';

    const container = step.container || document.body;
    if (this.root.parentElement !== container) container.append(this.root);
    this.root.hidden = false;

    if (step.scrollIntoView !== false && !this.isTargetComfortablyVisible()) {
      const avoidAnimatedScroll = window.matchMedia('(prefers-reduced-motion: reduce), (pointer: coarse), (max-width: 640px)').matches;
      this.target.scrollIntoView({ behavior: avoidAnimatedScroll ? 'auto' : 'smooth', block: 'center' });
    }
    this.queuePosition();
  }

  hide(): void {
    this.clearTarget();
    this.root.hidden = true;
    if (this.frame) window.cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  destroy(): void {
    this.hide();
    window.removeEventListener('resize', this.queuePosition);
    window.removeEventListener('scroll', this.queuePosition, true);
    this.root.remove();
  }

  private readonly queuePosition = (): void => {
    if (this.root.hidden || !this.target || this.frame) return;
    this.frame = window.requestAnimationFrame(() => {
      this.frame = 0;
      this.position();
    });
  };

  private clearTarget(): void {
    this.target?.classList.remove('guided-target-active');
    this.target = null;
  }

  private isTargetComfortablyVisible(): boolean {
    if (!this.target) return false;
    const rect = this.target.getBoundingClientRect();
    return rect.top >= 86 && rect.left >= 12 && rect.bottom <= window.innerHeight - 32 && rect.right <= window.innerWidth - 12;
  }

  private position(): void {
    if (!this.target || this.root.hidden) return;
    const target = this.target.getBoundingClientRect();
    const hint = this.root.getBoundingClientRect();
    const margin = 12;
    const gap = 16;
    const preferred = (this.root.dataset.preferredPlacement || 'below') as GuidePlacement;
    const order: GuidePlacement[] = [preferred, 'below', 'above', 'right', 'left'].filter(
      (value, index, values) => values.indexOf(value) === index,
    ) as GuidePlacement[];

    const pointFor = (placement: GuidePlacement): { left: number; top: number } => {
      if (placement === 'above') return {
        left: target.left + target.width / 2 - hint.width / 2,
        top: target.top - hint.height - gap,
      };
      if (placement === 'left') return {
        left: target.left - hint.width - gap,
        top: target.top + target.height / 2 - hint.height / 2,
      };
      if (placement === 'right') return {
        left: target.right + gap,
        top: target.top + target.height / 2 - hint.height / 2,
      };
      return {
        left: target.left + target.width / 2 - hint.width / 2,
        top: target.bottom + gap,
      };
    };

    const fits = ({ left, top }: { left: number; top: number }): boolean => (
      left >= margin
      && top >= margin
      && left + hint.width <= window.innerWidth - margin
      && top + hint.height <= window.innerHeight - margin
    );
    const placement = order.find((candidate) => fits(pointFor(candidate))) || preferred;
    const desired = pointFor(placement);
    const left = Math.min(Math.max(desired.left, margin), Math.max(margin, window.innerWidth - hint.width - margin));
    const top = Math.min(Math.max(desired.top, margin), Math.max(margin, window.innerHeight - hint.height - margin));
    const arrowX = Math.min(Math.max(target.left + target.width / 2 - left, 18), hint.width - 18);
    const arrowY = Math.min(Math.max(target.top + target.height / 2 - top, 18), hint.height - 18);

    this.root.dataset.placement = placement;
    this.root.style.left = `${Math.round(left)}px`;
    this.root.style.top = `${Math.round(top)}px`;
    this.root.style.setProperty('--guide-arrow-x', `${Math.round(arrowX)}px`);
    this.root.style.setProperty('--guide-arrow-y', `${Math.round(arrowY)}px`);
  }
}
