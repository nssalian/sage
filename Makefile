.PHONY: help install lint test clean

help:
	@echo "Sage - AI Code Review Action"
	@echo ""
	@echo "Available commands:"
	@echo "  make install    Install dependencies"
	@echo "  make lint       Run linter"
	@echo "  make test       Run tests"
	@echo "  make clean      Remove node_modules"

install:
	npm install

lint:
	npm run lint

test:
	npm test

clean:
	rm -rf node_modules package-lock.json
