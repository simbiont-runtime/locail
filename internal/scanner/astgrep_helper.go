package scanner

import (
	"os/exec"
)

// CheckAstGrep checks if ast-grep is installed.
func CheckAstGrep() error {
	_, err := exec.LookPath("ast-grep")
	return err
}

// InstallAstGrep provides installation instructions.
func InstallAstGrep() string {
	return `ast-grep is required for code scanning.
Install it with one of:
  brew install ast-grep          # macOS
  cargo install ast-grep         # via Cargo
  npm install -g @ast-grep/cli   # via npm
`
}