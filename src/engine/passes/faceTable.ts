// The face table's layout (S §4.4): texel offsets inside a face's 96-texel row. A leaf module: reshape.ts builds its
// shader text from it at load time, and faceCap.ts packs rows with it. 70–71 are reserved (step 5 right-side
// strengths), 75–95 spare (step 5).
export const FT = { ROW: 96, PTS: 0, EXT: 56, VT: 60, NT: 63, CHIN_EYE: 65, S1: 66, S2: 67, RADII: 68, PROT: 69, RIGHT: 70, BOX: 72, CAP: 73, WIN: 74 } as const;
