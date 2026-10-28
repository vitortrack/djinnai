# Autocomplete Bash da DETRO CLI.

_detro_completion() {
    if [[ ${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=($(compgen -W "start restart rebuild logs status stop clean execute hot-reload auto-remove worker help version" -- "${COMP_WORDS[1]}"))
    fi
}

complete -F _detro_completion detro
