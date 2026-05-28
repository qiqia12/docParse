.PHONY: up down build test logs clean

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build

test:
	cd parser && python3 -m pytest tests/ -v
	cd api && npx vitest run
	cd web && npx vitest run

logs:
	docker compose logs -f

clean:
	docker compose down -v
	rm -rf data/files/* data/images/*
