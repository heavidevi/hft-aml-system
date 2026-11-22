CXX      ?= g++
CXXFLAGS ?= -std=c++17 -O2 -Wall -Wextra -D__USE_MINGW_ANSI_STDIO=1 -Iinclude

ifeq ($(OS),Windows_NT)
MKDIR_BUILD = if not exist build mkdir build
RUN_TEST = build\\test_engine
RM_BUILD = if exist build rmdir /s /q build
else
MKDIR_BUILD = mkdir -p build
RUN_TEST = ./build/test_engine
RM_BUILD = rm -rf build
endif

all: build/hft_engine

SRC = src/engine.cpp src/sim.cpp
HDR = include/engine.h include/ds.h include/sim.h

build/hft_engine: src/main.cpp $(SRC) $(HDR)
	@$(MKDIR_BUILD)
	$(CXX) $(CXXFLAGS) src/main.cpp $(SRC) -o $@

build/test_engine: tests/test_engine.cpp $(SRC) $(HDR)
	@$(MKDIR_BUILD)
	$(CXX) $(CXXFLAGS) -g -fsanitize=address,undefined tests/test_engine.cpp $(SRC) -o $@

test: build/test_engine
	$(RUN_TEST)

clean:
	@$(RM_BUILD)

.PHONY: all test clean
