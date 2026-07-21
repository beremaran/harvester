# Harvester test harness.
#
# Everything runs INSIDE the container (Chromium + pinned Playwright live there;
# there is no host venv). These targets build Dockerfile.test and run pytest in
# it. The live anti-bot/fingerprint tests need outbound network and
# opt in via RUN_LIVE_TESTS=1 (Docker allows egress by default).
#
#   make test            # offline suite, no network
#   make test-live       # ALL live fingerprint/anti-bot tests
#   make live-<target>   # one live target, e.g. `make live-rebrowser`
#
# live-<target> maps to `pytest -m live -k <target>`. Available <target> tokens:
#   sannysoft rebrowser areyouheadless creepjs webgl iphey tls cloudflare
#   (plus `automation` for the raw-signals test). List them: `make live-list`.
#
# Forward extra pytest args with PYTEST_ARGS, e.g. `make test-live PYTEST_ARGS=-x`.

DOCKER      ?= docker
RUN_IMAGE   ?= harvester:latest
TEST_IMAGE  ?= harvester:test
SHM         ?= 1g
PYTEST      ?= pytest -v
PYTEST_ARGS ?=

TEST_RUN      = $(DOCKER) run --rm --shm-size=$(SHM) $(TEST_IMAGE)
TEST_RUN_LIVE = $(DOCKER) run --rm --shm-size=$(SHM) -e RUN_LIVE_TESTS=1 $(TEST_IMAGE)

.DEFAULT_GOAL := help

.PHONY: help
help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | \
	  awk 'BEGIN{FS=":.*?## "}{printf "  \033[36m%-16s\033[0m %s\n", $$1, $$2}'
	@echo "  \033[36mlive-<target>\033[0m    Run one live target (make live-list to see tokens)"

.PHONY: build
build: ## Build the runtime image
	$(DOCKER) build -t $(RUN_IMAGE) .

.PHONY: build-test
build-test: ## Build the test image
	$(DOCKER) build -f Dockerfile.test -t $(TEST_IMAGE) .

.PHONY: run
run: build ## Run the API on :8080
	$(DOCKER) run --rm --shm-size=$(SHM) -p 8080:8080 $(RUN_IMAGE)

.PHONY: test
test: build-test ## Run the offline suite (no network)
	$(TEST_RUN) $(PYTEST) tests $(PYTEST_ARGS)

.PHONY: test-live
test-live: build-test ## Run ALL live fingerprint/anti-bot tests (needs network)
	$(TEST_RUN_LIVE) $(PYTEST) -m live tests $(PYTEST_ARGS)

# Per-target: `make live-rebrowser`, `make live-tls`, ... -> pytest -m live -k <target>
.PHONY: live-%
live-%: build-test
	$(TEST_RUN_LIVE) $(PYTEST) -m live -k "$*" tests $(PYTEST_ARGS)

.PHONY: live-list
live-list: build-test ## List the live tests (names/keywords) without running them
	$(TEST_RUN_LIVE) $(PYTEST) -m live --collect-only -q tests

.PHONY: lint
lint: build-test ## Check lint + formatting (no changes)
	$(TEST_RUN) ruff check src tests
	$(TEST_RUN) ruff format --check src tests

.PHONY: lint-fix
lint-fix: build-test ## Autofix lint issues and reformat (writes back to host)
	$(DOCKER) run --rm --shm-size=$(SHM) -v $(CURDIR):/srv $(TEST_IMAGE) sh -c \
	  "ruff check --fix src tests && ruff format src tests"
