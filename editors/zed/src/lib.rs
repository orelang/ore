use zed_extension_api::{self as zed, settings::LspSettings, LanguageServerId, Result};

struct OreExtension;

impl zed::Extension for OreExtension {
    fn new() -> Self {
        OreExtension
    }

    /// Runs `ore lsp`. The binary is taken from the `lsp.ore.binary` setting,
    /// or found on the worktree's `PATH`.
    fn language_server_command(
        &mut self,
        language_server_id: &LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let binary = LspSettings::for_worktree(language_server_id.as_ref(), worktree)
            .ok()
            .and_then(|settings| settings.binary);
        let configured_path = binary.as_ref().and_then(|b| b.path.clone());
        let args = binary
            .as_ref()
            .and_then(|b| b.arguments.clone())
            .unwrap_or_else(|| vec!["lsp".to_string()]);
        let mut env = worktree.shell_env();
        if let Some(extra) = binary.and_then(|b| b.env) {
            env.extend(extra);
        }

        let command = match configured_path.or_else(|| worktree.which("ore")) {
            Some(path) => path,
            None => {
                return Err("`ore` was not found on PATH. Build it with `bun run build` in the Ore \
                     repository and put dist/ore on PATH, or set `lsp.ore.binary.path` in settings."
                    .to_string())
            }
        };
        Ok(zed::Command { command, args, env })
    }
}

zed::register_extension!(OreExtension);
