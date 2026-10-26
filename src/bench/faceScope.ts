// /bench.html's 美顏對象 (camera per-person spec §12.4; round-1 review C24, round-2 review D12 and Codex #2): who the
// bench's live loop beautifies. 'every' (the default): 全部套用 with the mode's look, so every tracked face runs its face
// passes, v0.6's worst case (as row LF). 'target': only the target, the others 原圖, as 0.5's bench drew it (getAll
// false: its FaceTracks eased each face toward `present && id === target`, so one face ran the passes), so a multi-face
// row compares like for like with 0.5's.
//
// The invariant of 'target': at every change of who is in view or of the auto pick (every `sync`, which FaceTracks runs
// on each frame's step, after the call's releases and takes and before the easers read `edited`), at a 參數 change and at
// the switch, the session's only edited person, in view, held or away, is the current target, and the target has the
// current look. The target is the auto pick, as 0.5's was on a page nobody taps: the bench writes with `write`, which
// never pins (an `edit` would pin the auto pick, K9, and the target would stop following the largest face).
// Round 1 edited a target only while it was unedited and wrote 原圖 once, to the faces in view at the switch: the first
// target, edited from 每張臉, was never written, the away persons kept 每張臉's look, a returning target kept the
// previous mode's look, and each new target was edited without un-editing the last, so two or more faces ran the passes.
import { type LivePersonId, LivePersons } from '../app/livePersons';
import { isNeutralPerson, neutralPerson } from '../edit/state';
import type { PersonParams } from '../types';

export type FaceScope = 'every' | 'target';

/** the bench's camera session: a LivePersons that keeps itself to the scope */
export class BenchPersons extends LivePersons {
  private mode: FaceScope = 'every';
  private look: PersonParams;
  /**
   * every person the session made or took back (`take` is the only way in) that it may still have to write: edited, or
   * in view. One not edited and out of view is dropped; if they come back, it is through `take` again
   */
  private readonly ids = new Set<LivePersonId>();

  constructor(look: PersonParams) {
    super();
    this.look = look;
    this.setAll(true);
    this.edit(look);
  }

  get scope(): FaceScope {
    return this.mode;
  }

  setScope(s: FaceScope): void {
    if (s === this.mode) return;
    this.mode = s;
    if (s === 'every') {
      // 全部套用 copies the target's look to everyone in view; the write sets the shared look a newcomer gets
      this.setAll(true);
      this.edit(this.look);
    } else {
      this.setAll(false);
      this.keep();
    }
  }

  /** the 參數 mode's person */
  setLook(p: PersonParams): void {
    this.look = p;
    if (this.mode === 'every') this.edit(p);
    else this.keep();
  }

  override take(away: LivePersonId | null): LivePersonId {
    const id = super.take(away);
    this.ids.add(id);
    return id;
  }

  override sync(inView: readonly LivePersonId[], auto: LivePersonId | null): void {
    super.sync(inView, auto);
    this.keep();
  }

  override clear(): void {
    super.clear();
    this.ids.clear();
  }

  /** 'target': the invariant above; both scopes: the ids no write can need any more are dropped */
  private keep(): void {
    const target = this.mode === 'target' ? this.target() : null;
    const shown = this.inView();
    for (const id of this.ids) {
      if (this.mode === 'target' && id !== target && this.edited(id)) this.write([id], neutralPerson());
      if (!this.edited(id) && !shown.includes(id)) this.ids.delete(id);
    }
    if (target === null) return;
    const want = isNeutralPerson(this.look) ? null : this.look;
    if (this.params(target) !== want) this.write([target], this.look);
  }
}
