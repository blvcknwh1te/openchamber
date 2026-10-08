// Which home directory `~` entries in the config expand against.
//
// The store's own home is the folder the UI is rooted in, and in the VS Code
// runtime that folder is the workspace. Config entries are written against the
// user's real home instead (`~/.config/opencode/rules/*.md`), so expanding them
// against the rooted folder produced a path that does not exist: the listing
// came back empty and every `~` rule vanished from the composer picker without
// any error. A host that knows the real home states it separately, and that
// statement wins.
export const resolveRuleHome = (
    embeddedHome: string | undefined,
    storeHome: string | null | undefined,
): string | null => {
    if (typeof embeddedHome === 'string' && embeddedHome.trim().length > 0) return embeddedHome;
    if (typeof storeHome === 'string' && storeHome.trim().length > 0) return storeHome;
    return null;
};
