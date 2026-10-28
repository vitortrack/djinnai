# Autocomplete Bash do DjinnAI.

_djinn_completion() {
    if [[ ${COMP_CWORD} -eq 1 ]]; then
        COMPREPLY=($(compgen -W "start restart rebuild logs status stop clean execute hot-reload auto-remove worker help version" -- "${COMP_WORDS[1]}"))
    fi
}

complete -F _djinn_completion djinn djinnai
