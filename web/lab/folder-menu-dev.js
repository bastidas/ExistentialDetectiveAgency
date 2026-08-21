document.addEventListener("DOMContentLoaded", () => {
	const tabButtons = Array.from(
		document.querySelectorAll(".folder-tab-label[data-folder-target]")
	);

	const folders = Array.from(document.querySelectorAll(".folder"));
	const entropyButtons = Array.from(
		document.querySelectorAll(".entropy-btn[data-entropy-variant]")
	);
	const resetEntropyButton = document.querySelector(
		".entropy-btn[data-entropy-reset='true']"
	);
	const entropyState = {
		lastInteractedFolderId: null,
		dissolvedFolderIds: new Set(),
		activeOverlays: new Map(),
		isAnimating: false
	};
	const ENTROPY_CONFIG = {
		maxTileCount: 700, // Hard cap on total generated tiles (performance safety).
		// Phase 1: small "scout" group that starts moving before the rest.
		firstBatchCountMin: 36, // Minimum number of tiles in the first batch.
		firstBatchCountMax: 64, // Maximum number of tiles in the first batch.
		firstBatchLeadMs: 2600, // Delay before non-first-batch tiles begin.
		firstBatchDurationMs: 3200, // Base movement duration for first-batch tiles.
		firstBatchExtraWaver: 0.9, // Extra wobble multiplier for first-batch motion.
		// Global pacing
		baseDelayJitterMs: 700, // Randomized start-delay spread for first-batch tiles.
		postLeadDelayJitterMs: 1200, // Randomized extra delay spread for later tiles.
		// Opacity behavior: hold visible, then fade out.
		opacityHoldMs: 2600, // Time each tile stays fully opaque after motion starts.
		opacityDurationMs: 3800, // Base fade-out duration once fade begins.
		opacityDurationJitterMs: 1400, // Random variation added to fade duration.
		// Movement: ensure tiles travel well offscreen.
		offscreenBoostPx: 220, // Extra distance added after reaching viewport edge.
		offscreenVariancePx: 240, // Random extra distance variation past edge.
		offscreenMarginPx: 140, // How far beyond viewport bounds counts as "offscreen".
		baseTileScale: 3.5, // Multiplier for largest base tile size before subdivision.
		angleVariationDeg: 10, // Max smooth angle drift (+/- degrees) per tile path.
		speedStartBase: 0.5, // Base relative speed near path start.
		speedStartVariance: 0.3, // Random start-speed variation (+/-).
		speedEndBase: 3.5, // Base relative speed near path end.
		speedEndVariance: 1.0 // Random end-speed variation (+/-).
	};
	const ENTROPY_VARIANTS = {
		a: {
			durationBase: 3000,
			durationJitter: 500,
			distanceBase: 300,
			distanceJitter: 280,
			directionalX: 0.05,
			directionalY: -0.1,
			rotation: 30,
			scaleMin: 0.9,
			blurMax: 0.7
		},
		b: {
			durationBase: 2800,
			durationJitter: 1250,
			distanceBase: 360,
			distanceJitter: 340,
			directionalX: 0.85,
			directionalY: -0.35,
			rotation: 13,
			scaleMin: 0.82,
			blurMax: 0.95
		},
		c: {
			durationBase: 2600,
			durationJitter: 1200,
			distanceBase: 340,
			distanceJitter: 420,
			directionalX: 0,
			directionalY: -0.08,
			rotation: 28,
			scaleMin: 0.74,
			blurMax: 1.25
		}
	};

	if (!tabButtons.length || !folders.length) return;

	// Optional: enable dev-only visuals.
	// We treat any of these as "on":
	//   ?dev=1, ?dev=true, ?DEV=1, ?DEV=true
	(function ensureDevModeFlag() {
		try {
			const params = new URLSearchParams(window.location.search || "");
			const devLower = params.get("dev");
			const devUpper = params.get("DEV");
			const isDev =
				devLower === "1" ||
				devLower === "true" ||
				devUpper === "1" ||
				devUpper === "true";

			if (isDev) {
				document.body.setAttribute("data-dev-mode", "true");
			}
		} catch (e) {
			// Very defensive fallback: simple substring check.
			if (/\bdev=1\b/i.test(window.location.search)) {
				document.body.setAttribute("data-dev-mode", "true");
			}
		}
	})();

	function updateFolderPositions() {
		const viewportHeight = window.innerHeight;
		const visibleTab = viewportHeight * 0.04; // 4% of screen height

		folders.forEach((folder, index) => {
			const folderHeight = folder.offsetHeight;
			if (!folderHeight) return;

			// Position so only ~4% of viewport remains visible when closed
			const baseBottom = visibleTab - folderHeight;
			const overlapOffset = index * (viewportHeight * 0.01); // 1% extra per folder
			const closedBottom = baseBottom + overlapOffset;

			folder.style.setProperty("--folder-closed-bottom", `${closedBottom}px`);

			// When open, lift the folder so its bottom sits just above
			// the tab band, keeping other tabs visible.
			if (folder.classList.contains("is-open")) {
				const openBottom = visibleTab + overlapOffset;
				folder.style.bottom = `${openBottom}px`;
			} else {
				// Let CSS closed state take over
				folder.style.removeProperty("bottom");
			}
		});
	}

	function setOpenFolder(folderId) {
		const targetFolder = folders.find((folder) => folder.id === folderId);
		if (!targetFolder) {
			return;
		}
		entropyState.lastInteractedFolderId = targetFolder.id;

		const wasOpen = targetFolder.classList.contains("is-open");

		// Close all folders first
		folders.forEach((folder) => {
			folder.classList.remove("is-open");
		});

		// If it was previously closed, open it; if it was open, leave all closed (toggle off).
		if (!wasOpen) {
			targetFolder.classList.add("is-open");
		}

		// Recompute positions so open/closed folders align correctly
		updateFolderPositions();
	}

	tabButtons.forEach((btn) => {
		const targetId = btn.getAttribute("data-folder-target");
		if (!targetId) return;

		// Click: toggle the associated folder open/closed.
		btn.addEventListener("click", () => {
			setOpenFolder(targetId);
		});

		// Hover: visually highlight the associated folder as if hovered.
		btn.addEventListener("mouseenter", () => {
			const targetFolder = document.getElementById(targetId);
			if (targetFolder) {
				entropyState.lastInteractedFolderId = targetFolder.id;
				targetFolder.classList.add("is-hovered");
			}
		});

		btn.addEventListener("mouseleave", () => {
			const targetFolder = document.getElementById(targetId);
			if (targetFolder) {
				targetFolder.classList.remove("is-hovered");
			}
		});
	});

	// Initialize and keep positions in sync with viewport changes
	updateFolderPositions();
	window.addEventListener("resize", updateFolderPositions);

	function chooseBaseTileSize(width, height) {
		const minDimension = Math.min(width, height);
		let baseSize;
		if (minDimension > 880) baseSize = 56;
		else if (minDimension > 620) baseSize = 48;
		else if (minDimension > 420) baseSize = 40;
		else baseSize = 32;
		return Math.max(16, Math.round(baseSize * ENTROPY_CONFIG.baseTileScale));
	}

	function buildRecursiveTiles(width, height, baseSize) {
		const splitChances = [0.74, 0.58];
		const cells = [];
		const queue = [];
		const intWidth = Math.max(1, Math.floor(width));
		const intHeight = Math.max(1, Math.floor(height));

		for (let y = 0; y < intHeight; y += baseSize) {
			for (let x = 0; x < intWidth; x += baseSize) {
				queue.push({
					x,
					y,
					w: Math.min(baseSize, intWidth - x),
					h: Math.min(baseSize, intHeight - y),
					level: 0
				});
			}
		}

		while (queue.length) {
			const cell = queue.pop();
			if (!cell || cell.w < 4 || cell.h < 4) continue;
			const minDim = Math.min(cell.w, cell.h);
			const wouldExceedMaxLeaves = cells.length + queue.length + 3 >= ENTROPY_CONFIG.maxTileCount;
			const canSplit =
				cell.level < splitChances.length &&
				minDim >= 12 &&
				!wouldExceedMaxLeaves &&
				Math.random() < splitChances[cell.level];

			if (!canSplit || minDim <= 12) {
				cells.push(cell);
				continue;
			}

			const halfW = Math.max(4, Math.floor(cell.w / 2));
			const halfH = Math.max(4, Math.floor(cell.h / 2));
			const x2 = cell.x + halfW;
			const y2 = cell.y + halfH;
			const nextLevel = cell.level + 1;

			const children = [
				{ x: cell.x, y: cell.y, w: halfW, h: halfH },
				{ x: x2, y: cell.y, w: cell.w - halfW, h: halfH },
				{ x: cell.x, y: y2, w: halfW, h: cell.h - halfH },
				{ x: x2, y: y2, w: cell.w - halfW, h: cell.h - halfH }
			];

			children.forEach((child) => {
				if (child.w <= 0 || child.h <= 0) return;
				queue.push({
					x: child.x,
					y: child.y,
					w: child.w,
					h: child.h,
					level: nextLevel
				});
			});
		}

		return cells;
	}

	function resolveTargetFolder() {
		const openFolder = folders.find((folder) => folder.classList.contains("is-open"));
		if (openFolder) return openFolder;

		if (entropyState.lastInteractedFolderId) {
			return folders.find((folder) => folder.id === entropyState.lastInteractedFolderId);
		}

		return folders[0] || null;
	}

	function randomInRange(min, max) {
		return min + Math.random() * (max - min);
	}

	function computeExitDistance(startAbsX, startAbsY, dirX, dirY) {
		const rightBound = window.innerWidth + ENTROPY_CONFIG.offscreenMarginPx;
		const bottomBound = window.innerHeight + ENTROPY_CONFIG.offscreenMarginPx;
		const leftBound = -ENTROPY_CONFIG.offscreenMarginPx;
		const topBound = -ENTROPY_CONFIG.offscreenMarginPx;
		const candidates = [];
		if (dirX > 0.0001) candidates.push((rightBound - startAbsX) / dirX);
		if (dirX < -0.0001) candidates.push((leftBound - startAbsX) / dirX);
		if (dirY > 0.0001) candidates.push((bottomBound - startAbsY) / dirY);
		if (dirY < -0.0001) candidates.push((topBound - startAbsY) / dirY);
		const positive = candidates.filter((v) => Number.isFinite(v) && v > 0);
		const minToExit = positive.length
			? Math.min(...positive)
			: Math.max(window.innerWidth, window.innerHeight);
		return (
			minToExit +
			ENTROPY_CONFIG.offscreenBoostPx +
			Math.random() * ENTROPY_CONFIG.offscreenVariancePx
		);
	}

	function buildMotionKeyframes({
		startAbsX,
		startAbsY,
		variant,
		travelDistance,
		rotationDeg,
		scaleMin
	}) {
		const randomAngle = Math.random() * Math.PI * 2;
		const biasedX = Math.cos(randomAngle) + variant.directionalX * 0.25;
		const biasedY = Math.sin(randomAngle) + variant.directionalY * 0.25;
		const dirLen = Math.hypot(biasedX, biasedY) || 1;
		const dirX = biasedX / dirLen;
		const dirY = biasedY / dirLen;
		const baseAngle = Math.atan2(dirY, dirX);

		const maxJitter = (ENTROPY_CONFIG.angleVariationDeg * Math.PI) / 180;
		const jitterA = randomInRange(-maxJitter, maxJitter);
		const jitterB = randomInRange(-maxJitter, maxJitter);
		const jitterC = randomInRange(-maxJitter, maxJitter);

		const speedStart = Math.max(
			0.08,
			ENTROPY_CONFIG.speedStartBase +
				randomInRange(-ENTROPY_CONFIG.speedStartVariance, ENTROPY_CONFIG.speedStartVariance)
		);
		const speedEnd = Math.max(
			speedStart + 0.25,
			ENTROPY_CONFIG.speedEndBase +
				randomInRange(-ENTROPY_CONFIG.speedEndVariance, ENTROPY_CONFIG.speedEndVariance)
		);

		const steps = [
			{ t: 0, angle: baseAngle },
			{ t: 0.2, angle: baseAngle + jitterA * 0.45 },
			{ t: 0.5, angle: baseAngle + jitterB * 0.75 },
			{ t: 0.78, angle: baseAngle + jitterC },
			{ t: 1, angle: baseAngle + jitterC * 0.7 }
		];

		const segmentWeights = [];
		let totalWeight = 0;
		for (let i = 1; i < steps.length; i += 1) {
			const tMid = (steps[i - 1].t + steps[i].t) / 2;
			const accel = tMid * tMid;
			const localSpeed = speedStart + (speedEnd - speedStart) * accel;
			const dt = steps[i].t - steps[i - 1].t;
			const w = localSpeed * dt;
			segmentWeights.push(w);
			totalWeight += w;
		}

		const scaleDist = travelDistance / Math.max(totalWeight, 0.0001);
		let x = 0;
		let y = 0;
		const positions = [
			{ offset: 0, x: 0, y: 0, rot: 0, scale: 1 }
		];
		for (let i = 1; i < steps.length; i += 1) {
			const segDistance = segmentWeights[i - 1] * scaleDist;
			const ang = steps[i].angle;
			x += Math.cos(ang) * segDistance;
			y += Math.sin(ang) * segDistance;
			const rot = rotationDeg * steps[i].t;
			const tileScale = 1 - (1 - scaleMin) * steps[i].t;
			positions.push({
				offset: steps[i].t,
				x,
				y,
				rot,
				scale: tileScale
			});
		}

		const endAbsX = startAbsX + positions[positions.length - 1].x;
		const endAbsY = startAbsY + positions[positions.length - 1].y;
		const rightBound = window.innerWidth + ENTROPY_CONFIG.offscreenMarginPx;
		const bottomBound = window.innerHeight + ENTROPY_CONFIG.offscreenMarginPx;
		const leftBound = -ENTROPY_CONFIG.offscreenMarginPx;
		const topBound = -ENTROPY_CONFIG.offscreenMarginPx;
		if (
			endAbsX > leftBound &&
			endAbsX < rightBound &&
			endAbsY > topBound &&
			endAbsY < bottomBound
		) {
			const endX = positions[positions.length - 1].x;
			const endY = positions[positions.length - 1].y;
			const outDirLen = Math.hypot(endX, endY) || 1;
			const outDirX = endX / outDirLen;
			const outDirY = endY / outDirLen;
			const extra = computeExitDistance(endAbsX, endAbsY, outDirX, outDirY);
			const scaleFactor = (outDirLen + extra) / outDirLen;
			// Scale the entire path so the tile doesn't "jump" only at the final keyframe.
			positions.forEach((p) => {
				p.x *= scaleFactor;
				p.y *= scaleFactor;
			});
		}

		const keyframes = positions.map((p) => ({
			transform: `translate3d(${p.x.toFixed(2)}px, ${p.y.toFixed(2)}px, 0) rotate(${p.rot.toFixed(2)}deg) scale(${p.scale.toFixed(3)})`,
			offset: p.offset
		}));
		return keyframes;
	}

	function createTileNode({
		rect,
		snapshotCanvas,
		tile,
		sizeWeight,
		variant,
		isFirstBatch
	}) {
		const node = document.createElement("canvas");
		node.className = "entropy-tile";
		const tileW = Math.max(1, Math.floor(tile.w));
		const tileH = Math.max(1, Math.floor(tile.h));
		node.width = tileW;
		node.height = tileH;
		node.style.left = `${tile.x}px`;
		node.style.top = `${tile.y}px`;
		node.style.width = `${tileW}px`;
		node.style.height = `${tileH}px`;
		const nodeCtx = node.getContext("2d");
		if (nodeCtx) {
			nodeCtx.drawImage(
				snapshotCanvas,
				Math.floor(tile.x),
				Math.floor(tile.y),
				tileW,
				tileH,
				0,
				0,
				tileW,
				tileH
			);
		}

		const sizeDelayOffset = sizeWeight * 260;
		const randomDelay = isFirstBatch
			? Math.random() * ENTROPY_CONFIG.baseDelayJitterMs
			: ENTROPY_CONFIG.firstBatchLeadMs +
				Math.random() * ENTROPY_CONFIG.postLeadDelayJitterMs;
		const delay = Math.max(0, sizeDelayOffset + randomDelay);
		const duration = isFirstBatch
			? ENTROPY_CONFIG.firstBatchDurationMs + Math.random() * 1000
			: variant.durationBase +
				Math.random() * variant.durationJitter +
				(1 - sizeWeight) * 600;

		const travel =
			variant.distanceBase +
			Math.random() * variant.distanceJitter +
			sizeWeight * 120 +
			ENTROPY_CONFIG.offscreenBoostPx +
			Math.random() * ENTROPY_CONFIG.offscreenVariancePx;
		const rotation = (Math.random() - 0.5) * variant.rotation;
		const scale = variant.scaleMin + Math.random() * (1 - variant.scaleMin);
		const blur = Math.random() * variant.blurMax;
		const opacityDelay = delay + ENTROPY_CONFIG.opacityHoldMs;
		const opacityDuration =
			ENTROPY_CONFIG.opacityDurationMs +
			Math.random() * ENTROPY_CONFIG.opacityDurationJitterMs;
		const startAbsX = rect.left + tile.x + tileW / 2;
		const startAbsY = rect.top + tile.y + tileH / 2;
		const motionKeyframes = buildMotionKeyframes({
			startAbsX,
			startAbsY,
			variant,
			travelDistance: isFirstBatch ? travel * (1 + ENTROPY_CONFIG.firstBatchExtraWaver * 0.12) : travel,
			rotationDeg: rotation,
			scaleMin: scale
		});

		node.style.setProperty("--tile-delay", `${Math.round(delay)}ms`);
		node.style.setProperty("--tile-duration", `${Math.round(duration)}ms`);
		node.style.setProperty("--tile-opacity-delay", `${Math.round(opacityDelay)}ms`);
		node.style.setProperty("--tile-opacity-duration", `${Math.round(opacityDuration)}ms`);
		node.style.setProperty("--tile-blur", `${blur.toFixed(2)}px`);

		return {
			node,
			startDelay: delay,
			endTime: Math.max(delay + duration, opacityDelay + opacityDuration),
			tileW,
			tileH,
			motionKeyframes,
			motionDuration: duration
		};
	}

	async function runEntropyDisintegration(variantKey) {
		if (entropyState.isAnimating) return;
		const targetFolder = resolveTargetFolder();
		if (!targetFolder) return;
		if (entropyState.dissolvedFolderIds.has(targetFolder.id)) return;
		if (typeof window.html2canvas !== "function") return;

		const variant = ENTROPY_VARIANTS[variantKey];
		if (!variant) return;

		entropyState.isAnimating = true;

		try {
			const rect = targetFolder.getBoundingClientRect();
			if (!rect.width || !rect.height) return;

			const snapshotCanvas = await window.html2canvas(targetFolder, {
				backgroundColor: null,
				scale: 1,
				useCORS: true,
				logging: false
			});
			const overlay = document.createElement("div");
			overlay.className = "entropy-overlay";
			overlay.style.left = `${rect.left}px`;
			overlay.style.top = `${rect.top}px`;
			overlay.style.width = `${rect.width}px`;
			overlay.style.height = `${rect.height}px`;
			const baseLayer = document.createElement("canvas");
			baseLayer.className = "entropy-base-layer";
			baseLayer.width = Math.max(1, Math.floor(rect.width));
			baseLayer.height = Math.max(1, Math.floor(rect.height));
			baseLayer.style.width = `${rect.width}px`;
			baseLayer.style.height = `${rect.height}px`;
			const baseCtx = baseLayer.getContext("2d");
			if (baseCtx) {
				baseCtx.drawImage(snapshotCanvas, 0, 0);
			}
			overlay.appendChild(baseLayer);

			const baseSize = chooseBaseTileSize(rect.width, rect.height);
			const tiles = buildRecursiveTiles(rect.width, rect.height, baseSize);
			const firstBatchCount =
				ENTROPY_CONFIG.firstBatchCountMin +
				Math.floor(
					Math.random() *
						(Math.max(ENTROPY_CONFIG.firstBatchCountMax - ENTROPY_CONFIG.firstBatchCountMin + 1, 1))
				);
			const shuffledIndices = tiles.map((_, idx) => idx);
			for (let i = shuffledIndices.length - 1; i > 0; i -= 1) {
				const j = Math.floor(Math.random() * (i + 1));
				[shuffledIndices[i], shuffledIndices[j]] = [shuffledIndices[j], shuffledIndices[i]];
			}
			const firstBatchSet = new Set(shuffledIndices.slice(0, firstBatchCount));
			let maxEndTime = 0;
			const scheduledTimeouts = [];

			tiles.forEach((tile, tileIndex) => {
				const tileMinDim = Math.min(tile.w, tile.h);
				const sizeWeight = Math.min(1, Math.max(0, (baseSize - tileMinDim) / baseSize));
				const isFirstBatch = firstBatchSet.has(tileIndex);
				const tileResult = createTileNode({
					rect,
					snapshotCanvas,
					tile,
					sizeWeight,
					variant,
					isFirstBatch
				});

				maxEndTime = Math.max(maxEndTime, tileResult.endTime);
				const startTimer = window.setTimeout(() => {
					if (!overlay.isConnected) return;
					if (baseCtx) {
						baseCtx.clearRect(
							Math.floor(tile.x),
							Math.floor(tile.y),
							tileResult.tileW,
							tileResult.tileH
						);
					}
					overlay.appendChild(tileResult.node);
					requestAnimationFrame(() => {
						tileResult.node.classList.add("is-active");
						tileResult.node.animate(tileResult.motionKeyframes, {
							duration: Math.round(tileResult.motionDuration),
							easing: "linear",
							fill: "forwards"
						});
					});
				}, Math.round(tileResult.startDelay));
				scheduledTimeouts.push(startTimer);
			});

			document.body.appendChild(overlay);
			targetFolder.style.visibility = "hidden";
			targetFolder.classList.add("is-dissolved");
			entropyState.dissolvedFolderIds.add(targetFolder.id);
			entropyState.activeOverlays.set(targetFolder.id, overlay);

			window.setTimeout(() => {
				scheduledTimeouts.forEach((timerId) => window.clearTimeout(timerId));
				const activeOverlay = entropyState.activeOverlays.get(targetFolder.id);
				if (activeOverlay) {
					activeOverlay.remove();
					entropyState.activeOverlays.delete(targetFolder.id);
				}
			}, maxEndTime + 260);
		} catch (err) {
			console.error("[entropy] dissolve failed", err);
		} finally {
			entropyState.isAnimating = false;
		}
	}

	function resetEntropyState() {
		entropyState.activeOverlays.forEach((overlay) => {
			overlay.remove();
		});
		entropyState.activeOverlays.clear();
		entropyState.dissolvedFolderIds.clear();
		entropyState.isAnimating = false;

		folders.forEach((folder) => {
			folder.style.visibility = "";
			folder.classList.remove("is-dissolved");
		});
	}

	entropyButtons.forEach((button) => {
		button.addEventListener("click", () => {
			const variant = button.getAttribute("data-entropy-variant");
			if (!variant) return;
			runEntropyDisintegration(variant.toLowerCase());
		});
	});

	if (resetEntropyButton) {
		resetEntropyButton.addEventListener("click", () => {
			resetEntropyState();
		});
	}
});

