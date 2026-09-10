{
  description = "JJ Plus development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "aarch64-darwin"
        "x86_64-darwin"
        "aarch64-linux"
        "x86_64-linux"
      ];
      forEachSystem = nixpkgs.lib.genAttrs systems;
    in
    {
      formatter = forEachSystem (system: nixpkgs.legacyPackages.${system}.nixfmt);

      devShells = forEachSystem (
        system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = with pkgs; [
              corepack_24
              gh
              git
              jujutsu
              nixfmt
              nodejs_24
            ];

            shellHook = ''
              export COREPACK_HOME="$PWD/.direnv/corepack"
              export PATH="$PWD/.direnv/bin:$PATH"
              mkdir -p "$PWD/.direnv/bin" "$COREPACK_HOME"
              corepack enable --install-directory "$PWD/.direnv/bin" >/dev/null 2>&1
            '';
          };
        }
      );
    };
}
