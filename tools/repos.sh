# Sourced by tree.sh, overlay.sh, hero.sh and media-refresh.sh: the repo names the shell tools default to. Shell cannot import shared/repos.js, so the owner is written here
# once; test/python/test_site_org_owner.py fails when this and shared/repos.js (OWNER) disagree.
# Why (2 Nov 2026, owner: the Build Log read a repo by its pre-move name): no tool names the old owner; git follows a rename, but a search or a POST does not.
JOBADABRA_PUBLIC_REPO="${JOBADABRA_PUBLIC_REPO:-jobadabra/jobadabra}"
JOBADABRA_WEB_REPO="${JOBADABRA_WEB_REPO:-jobadabra/jobadabra-web}"
