/* eslint-disable no-await-in-loop */
/*
 * Twitch WildRP Only
 * Created by bcbray & Vaeb
 */

const startDate = new Date();
const tzOffset = (startDate.getHours() - startDate.getUTCHours()) * 1000 * 60 * 60;
const dateStr = (date = new Date()) =>
    new Date(+date + tzOffset)
        .toISOString()
        .replace('T', ' ')
        .replace(/\.\w+$/, '');

console.log(`[${dateStr()}] [TWRPO] Loading Twitch WildRP Only...`);

const getStorage = (keys, defaultVal = undefined) =>
    new Promise((resolve) => {
        let useKeys = keys;
        if (Array.isArray(keys)) useKeys = keys.map(data => (Array.isArray(data) ? data[0] : data));

        chrome.storage.local.get(useKeys, (values) => {
            let val;
            if (typeof keys === 'string') {
                val = values[keys];
                if (val === undefined) val = defaultVal;
            } else {
                val = [];
                for (let i = 0; i < keys.length; i++) {
                    const k = useKeys[i];
                    const kDefault = Array.isArray(keys[i]) ? keys[i][1] : undefined;
                    let v = values[k];
                    if (v === undefined) v = kDefault;
                    val.push(v);
                }
            }
            resolve(val);
        });
    });

const setStorage = async (key, val) => chrome.storage.local.set({ [key]: val });

const remStorage = async key => chrome.storage.local.remove(key);

// eslint-disable-next-line
window.twrpoGet = getStorage;
// eslint-disable-next-line
window.twrpoSet = setStorage;
// eslint-disable-next-line
window.twrpoRem = remStorage;

String.prototype.indexOfRegex = function (regex, startPos) {
    const indexOf = this.substring(startPos || 0).search(regex);
    return indexOf >= 0 ? indexOf + (startPos || 0) : indexOf;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const waitForElement = async (selector, maxTime = Infinity) => {
    let el;
    let timer;

    if (typeof selector === 'string') {
        const selectorString = selector;
        selector = () => document.querySelector(selectorString);
    }

    const initStamp = +new Date();

    while ((el = selector()) == null) {
        // eslint-disable-next-line
        await new Promise((resolve) => {
            cancelAnimationFrame(timer);
            timer = requestAnimationFrame(resolve);
        });

        if (+new Date() - initStamp >= maxTime) {
            console.log('waitForElement timed out after', maxTime, 'ms');
            break;
        }
    }

    return el;
};

const getAncester = (el, count) => count > 0 ? getAncester(el.parentElement, count - 1) : el;

const twitchRdr2Url = /^https:\/\/www\.twitch\.tv\/directory\/game\/Red%20Dead%20Redemption%202(?!\/videos|\/clips)/;

// Settings

let minViewers;
let stopOnMin;
let intervalSeconds;
const fullDebugging = false;

let baseHtml;
let baseHtmlFb;

let keepDeleting = true;
let onPage = false;
let interval;

let wasZero = false;
let filterStreamFaction = 'allwildrp';
let filterStreamText = '';
let filterStreamTextLookup = '';
let isFilteringText = false;

let useColors = {};
let useColorsDark = {};
let useColorsLight = {};

let targetElementSelector;
let hopsToMainAncestor;
let channelNameElementSelector;
let liveBadgeElementSelector;
let liveBadgeContentElementSelector;
let viewersBadgeElementSelector;
let mainScrollSelector;
let settingsTargetElementSelector;
let hopsToSettingsContainerAncestor;
let insertionElementSelector;



const FSTATES = {
    remove: 0,
    wildrp: 1,
    other: 2,
    hide: 3,
};

const SORTS = {
    recommended: 1,
    high: 2,
    low: 3,
    recent: 4,
};

const REAL_VIEWS = new Map([ // Key represents alwaysRoll value
    [false, ['allwildrp', 'alltwitch']],
    [true, ['alltwitch']],
]);

let realViews = REAL_VIEWS.get(false); // Views with real-stream elements

const universalFactions = ['allwildrp', 'alltwitch'];

const onDefaultView = () => filterStreamFaction === 'allwildrp' && isFilteringText === false;

const onRealView = () => realViews.includes(filterStreamFaction) && isFilteringText === false;

const onUniversalFaction = () => universalFactions.includes(filterStreamFaction) && isFilteringText === false;

// Does view contain multiple actual RP factions (rather than just a dedicated RP faction)
// Both real-stream and manual-stream
const onWrpMetaFaction = () => {
    const wrpMetaFactions = [...universalFactions, 'otherwrp', 'guessed'];
    return isFilteringText || wrpMetaFactions.includes(filterStreamFaction);
};

RegExp.escape = function (string) {
    return string.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
};

let activateInterval;
let stopInterval;

const filterStreams = async () => { // Remember: The code here runs upon loading twitch.tv, not the RDR2 page. For the latter, use activateInterval.
    console.log(`[${dateStr()}] Fetching WRP stream data...`);
    const isDeveloper = typeof document.cookie === 'string' && document.cookie.includes('name=bcbray');

    let live;
    let streamsMap;
    let insertAfterReal;
    let filterListeners = [];
    let timeId = `#${new Date().getTime()}`;

    let onSettingChanged;

    const handleStreams = () => {
        const streams = live.streams;

        streamsMap = Object.assign({}, ...live.streams.map(stream => ({ [stream.channelName.toLowerCase()]: stream })));

        insertAfterReal = {};
        for (let i = 0; i < streams.length; i++) {
            const nowStream = streams[i];
            if (nowStream.facebook) {
                const prevStreamName = i === 0 ? '_start_' : streams[i - 1].channelName.toLowerCase();
                insertAfterReal[prevStreamName] = nowStream; // Must be inserted in order (adjacent edge-case)
            }
        }

        console.log('insertAfterReal', insertAfterReal);
    };

    const requestLiveData = async () => {
        const fetchHeaders = new Headers();
        fetchHeaders.append('pragma', 'no-cache');
        fetchHeaders.append('cache-control', 'no-cache');

        // https://twrponly.tc | http://localhost:3029
        const dataRequest = new Request('https://twrponly.tv/live'); // API code is open-source: https://github.com/bcbray/TWRPO-Backend
        // const dataRequest = new Request('http://localhost:3029/live'); // API code is open-source: https://github.com/bcbray/TWRPO-Backend

        const maxTries = 4;
        for (let i = 0; i < maxTries; i++) {
            try {
                const fetchResult = await fetch(dataRequest);
                live = await fetchResult.json();
                break;
            } catch (err) {
                if (i < (maxTries - 1)) {
                    console.log('Failed to fetch live data, retrying...');
                    await sleep(2000);
                } else {
                    console.error('Failed to fetch live data:');
                    throw new Error(err);
                }
            }
        }

        if (live == null || live.streams == null || live.streams.length === 0) {
            console.log('Failed to fetch live data (empty):', live);
            return false;
        }

        // let waitForFilterResolve;
        // const waitForFilter = new Promise((resolve) => {
        //     waitForFilterResolve = resolve;
        // });

        // const waitForFilterAndStreams = Promise.all([waitForFilter, waitForAllStreams]);
        // waitForFilterAndStreams.then(() => {
        //     console.log('filter and streams ready');
        // });

        ({
            minViewers,
            stopOnMin,
            intervalSeconds,
            useColorsDark,
            useColorsLight,
            baseHtml,
            baseHtmlFb,
            injectionConfiguration: {
                targetElementSelector,
                hopsToMainAncestor,
                channelNameElementSelector,
                liveBadgeElementSelector,
                liveBadgeContentElementSelector,
                viewersBadgeElementSelector,
                mainScrollSelector,
                settingsTargetElementSelector,
                hopsToSettingsContainerAncestor,
                insertionElementSelector
            },
        } = live);

        console.log(`[${dateStr()}] Fetched data!`);

        console.log('live', live);

        handleStreams();
        console.log('streamsMap', streamsMap);

        return true;
    };

    const requestResult = await requestLiveData();
    console.log('requestResult', requestResult);

    if (requestResult !== true) return;

    const bodyHexColor = getComputedStyle(document.body).getPropertyValue('--color-background-body');
    let isDark = true;

    if (bodyHexColor === '#f7f7f8') {
        useColors = useColorsLight;
        isDark = false;
    } else {
        useColors = useColorsDark;
    }

    let sortType = SORTS.recommended;

    const fixSortType = async (n) => {
        const sortByLabel = await waitForElement('label[for="browse-header-filter-by"]', n);
        const sortByDiv = sortByLabel.parentNode.parentNode;

        const sortTypeText = sortByDiv.querySelector('button[data-a-target="browse-sort-menu"]').textContent.toLowerCase();
        if (sortTypeText.includes('recommended')) {
            sortType = SORTS.recommended;
        } else if (sortTypeText.includes('high to')) {
            sortType = SORTS.high;
        } else if (sortTypeText.includes('low to')) {
            sortType = SORTS.low;
        } else if (sortTypeText.includes('recent')) {
            sortType = SORTS.recent;
        }
    };

    // If twrpoReloadDefault hasn't been manually set yet then set to false if sort=Recommended, else set to true
    let [twrpoStatus, twrpoEnglish, twrpoOthers, twrpoSearch, twrpoScrolling, twrpoAlwaysCustom, twrpoReloadDefault, twrpoAllowAll] = await getStorage([
        ['twrpoStatus', true],
        ['twrpoEnglish', true],
        ['twrpoOthers', false],
        ['twrpoSearch', true],
        ['twrpoScrolling', false],
        ['twrpoAlwaysCustom', false],
        ['twrpoReloadDefault', false],
        ['twrpoAllowAll', false],
    ]);

    const filterEnabled = !isDeveloper || !twrpoAllowAll; // Fail-safe incase extension accidentally gets published with twrpoAllowAll enabled

    let isDeleting = false;
    let minLoadedViewers = null;
    let minLoadedText = null;
    let rollStart = 0;
    let alwaysRoll = twrpoAlwaysCustom;

    realViews = REAL_VIEWS.get(alwaysRoll);
    const rollAddMax = 30;

    // const resetFiltering = () => {
    //     const elements = Array.from(document.getElementsByTagName('article')).filter(element => element.classList.contains('npChecked'));
    //     console.log('resetting for', elements.length, 'elements');
    //     elements.forEach((element) => {
    //         element.classList.remove('npChecked');
    //     });
    // };

    const escapeChars = {
        '¢': 'cent',
        '£': 'pound',
        '¥': 'yen',
        '€': 'euro',
        '©': 'copy',
        '®': 'reg',
        '<': 'lt',
        '>': 'gt',
        '"': 'quot',
        '&': 'amp',
        "'": '#39',
    };

    let regexString = '[';
    for (const key of Object.keys(escapeChars)) {
        regexString += key;
    }
    regexString += ']';

    const regex = new RegExp(regexString, 'g');

    const encodeHtml = str => str.replace(regex, m => `&${escapeChars[m]};`);

    const resetFiltering = (onlyChecked = false) => {
        if (!onlyChecked) {
            const manualElements = Array.from(document.querySelector(targetElementSelector)).filter(element => element.classList.contains('npManual'));
            console.log('removing', manualElements.length, 'manual elements');
            for (const element of manualElements) {
                getAncester(element, hopsToMainAncestor).remove();
            }
        }

        const elements = Array.from(document.querySelector(targetElementSelector)).filter(element => element.classList.contains('npChecked'));
        console.log('resetting for', elements.length, 'elements');
        elements.forEach((element) => {
            element.classList.remove('npChecked');
        });
    };

    const matchesFilterStreamText = stream =>
        stream.tagText.toLowerCase().includes(filterStreamText)
            || (stream.characterName && stream.characterName.toLowerCase().includes(filterStreamText))
            || (stream.nicknameLookup && stream.nicknameLookup.includes(filterStreamTextLookup))
            || stream.channelName.toLowerCase().includes(filterStreamText)
            || stream.title.toLowerCase().includes(filterStreamText);

    const addClass = (el, ...classes) => {
        for (const c of classes) {
            if (!el.classList.contains(c)) {
                el.classList.add(c);
            }
        }
    };

    const removeClass = (el, ...classes) => {
        for (const c of classes) {
            if (el.classList.contains(c)) {
                el.classList.remove(c);
            }
        }
    };

    const numToTwitchViewers = (n) => {
        if (n < 1000) return `${n}`;
        return `${parseFloat((n / 1e3).toFixed(1))}K`;
    };

    const makeStreamHtml = (stream, idx) => {
        if (idx === undefined) idx = stream.id;

        const channelName = stream.channelName;
        const channelNameLower = channelName.toLowerCase();
        let cloneHtml = baseHtml;
        if (stream.facebook) {
            cloneHtml = baseHtmlFb
                .replace(/_VIDEOURL_/g, `${stream.videoUrl}`)
                .replace(/_THUMBNAIL_/g, `${stream.thumbnailUrl}`);
        }
        cloneHtml = cloneHtml
            .replace(/(?<=<article .*?)class="/i, 'class="npManual ')
            .replace(/_TNOID_/g, `${idx}`)
            .replace(/_TIMEID_/g, `${timeId}`)
            .replace(/_CHANNEL1_/g, channelNameLower)
            .replace(/_CHANNEL2_/g, channelName)
            .replace(/_ORDER_/g, '0')
            .replace(/"_TITLE_/g, `"${encodeHtml(stream.title)}`)
            .replace(/_TITLE_/g, stream.title)
            .replace(/_VIEWERS_/g, numToTwitchViewers(stream.viewers))
            .replace(/_PFP_/g, stream.profileUrl);
        return cloneHtml;
    };

    const insertStreamSingle = (baseIdx, baseChannelName, elements, element, stream = insertAfterReal[baseChannelName]) => {
        console.log('> ADDING', stream.channelName, 'after', baseChannelName, element);
        const newIdx = stream.id;
        const cloneHtml = makeStreamHtml(stream);
        element.insertAdjacentHTML('afterEnd', cloneHtml);
        const streamEl = document.querySelector(`#tno-stream-${newIdx}`);
        const target = streamEl.querySelector(targetElementSelector);
        streamEl.style.order = element.style.order;
        // addClass(article, 'npChecked');
        elements.splice(baseIdx + 1, 0, target);
    };

    const deleteOthers = () => {
        if (onPage == false) return;
        // if (onPage == false || isDeleting === true) return;
        isDeleting = true;

        isFilteringText = filterStreamText !== '';

        const useTextColor = '#000';
        // const useTextColor = isDark ? '#000' : '#f7f7f8';
        const isRealView = onRealView();
        const isUniversalFaction = onUniversalFaction();
        const isNpMetaFaction = onWrpMetaFaction();
        const minViewersUse = isNpMetaFaction ? minViewers : 3;

        const allElements = Array.from(document.querySelectorAll(targetElementSelector));
        const elements = allElements.filter(element => !element.classList.contains('npChecked'));
        const streamCount = document.getElementById('streamCount');

        const prevWasZero = wasZero;

        let isFirstRemove = true;
        if (elements.length > 0 || !wasZero) {
            console.log('[TWRPO] _There are so many elements:', elements.length);
            wasZero = elements.length === 0;
        }

        // if (elements.length > 0 && prevWasZero) {
        //     const $scrollDiv = $('div.root-scrollable.scrollable-area').find('> div.simplebar-scroll-content');
        //     const bottomRem = ($scrollDiv[0].scrollHeight - $scrollDiv.height()) - $scrollDiv.scrollTop();
        //     console.log('before-deletion bottomRem:', bottomRem);
        // }

        let allowNextManual = false;

        // console.log('>>>> STARTING NEW ELEMENTS LOOP');

        for (let elementIdx = 0; elementIdx < elements.length; elementIdx++) {
            let element = elements[elementIdx];
            const allowNextManualNow = allowNextManual; // Manuals not being removed here?
            allowNextManual = false;

            const isManualStream = element.classList.contains('npManual');
            element.classList.add('npChecked');
            element = getAncester(element, hopsToMainAncestor);
            const channelEl = element.querySelector(channelNameElementSelector);
            const channelElNode = [...channelEl.childNodes].find(node => node.nodeType === 3);
            let liveElDiv = element.querySelector(liveBadgeElementSelector);
            const viewers = element.querySelector(viewersBadgeElementSelector).textContent;

            let viewersNum = parseFloat(viewers);
            if (viewers.includes('K viewer')) viewersNum *= 1000;
            if (Number.isNaN(viewersNum)) viewersNum = minLoadedViewers != null ? minLoadedViewers : minViewersUse;

            if (minLoadedViewers == null || viewersNum < minLoadedViewers) {
                minLoadedViewers = viewersNum;
                minLoadedText = viewers;
            }

            let liveEl;
            if (liveElDiv != null) {
                liveEl = liveElDiv.querySelector(liveBadgeContentElementSelector);
            } else {
                liveElDiv = $('<div>')[0];
                liveEl = $('<div>')[0];
            }

            const channelName = channelElNode.textContent.toLowerCase();
            const stream = streamsMap[channelName];

            const nowFilterEnabled = filterEnabled && filterStreamFaction !== 'alltwitch';
            const twrpoOthersNow = twrpoOthers || filterStreamFaction === 'other';

            if (isRealView && insertAfterReal[channelName]) {
                const addStream = insertAfterReal[channelName];
                const removeEls = [...document.querySelectorAll(`#tno-stream-${addStream.id}`)];
                for (const removeEl of removeEls) {
                    removeEl.remove();
                }
                insertStreamSingle(elementIdx, channelName, elements, element, addStream);
                // console.log(elements.map(el => getChannelNameFromEl(el)));
                allowNextManual = true;
            }

            let streamState; // remove, mark-np, mark-other
            if (isManualStream === false && isRealView === false) { // If real-stream and on a view with manual-streams-only
                streamState = FSTATES.hide;
            } else if (isManualStream === true && isRealView === true && allowNextManualNow === false) { // If real-stream and on a view with manual-streams-only
                element.remove();
                console.log('REMOVED BAD', channelName, element);
                continue;
            } else {
                if (nowFilterEnabled) {
                    // If filtering streams is enabled
                    if (!stream) {
                        // Not an RP stream
                        streamState = FSTATES.remove;
                    } else if (stream.tagFaction === 'other') {
                        // Non-WildRP RP stream
                        if (twrpoOthersNow) {
                            streamState = FSTATES.other;
                        } else {
                            streamState = FSTATES.remove;
                        }
                    } else {
                        streamState = FSTATES.wildrp;
                    }
                } else {
                    if (stream && stream.tagFaction !== 'other') {
                        // If WildRP streamer that isn't on another server
                        if (isUniversalFaction || isFilteringText) {
                            streamState = FSTATES.wildrp;
                        } else {
                            // Public/International stream when not allowed and using filter
                            streamState = FSTATES.remove;
                        }
                    } else {
                        streamState = FSTATES.other;
                    }
                }
            }

            const hoverEl = element.querySelector('.tw-hover-accent-effect');

            if (streamState === FSTATES.other) {
                // Other included RP servers
                const streamPossible = stream || {};

                if (element.style.display === 'none') {
                    element.style.display = null;
                }

                if (element.style.visibility === 'hidden') {
                    element.style.visibility = null;
                }

                const allowStream = isUniversalFaction || isFilteringText || filterStreamFaction === 'other';

                if (allowStream === false) {
                    streamState = FSTATES.remove;
                } else {
                    channelEl.style.color = useColors.other;
                    liveElDiv.style.backgroundColor = useColorsDark.other;
                    liveEl.style.color = useTextColor;
                    liveEl.style.setProperty('text-transform', 'none', 'important');
                    liveEl.textContent = streamPossible.tagText ? streamPossible.tagText : '';

                    if (hoverEl) {
                        hoverEl.style.setProperty('--color-accent', useColors.other);
                    }
                }
            } else if (streamState === FSTATES.wildrp) {
                // WildRP stream
                if (element.style.display === 'none') {
                    element.style.display = null;
                }

                if (element.style.visibility === 'hidden') {
                    element.style.visibility = null;
                }

                let allowStream = false;

                if (isFilteringText) {
                    allowStream = true;
                } else {
                    // Don't do filtering on meta factions (not faction specific)
                    allowStream = isUniversalFaction;
                    if (allowStream === false) {
                        if (filterStreamFaction === 'publicnp') {
                            allowStream = stream.tagFactionSecondary === 'publicnp';
                        } else if (filterStreamFaction === 'international') {
                            allowStream = stream.tagFactionSecondary === 'international';
                        // } else if (isDefaultView && rollStart > 0) {
                            // allowStream = stream.factionsMap.whitelistnp;
                        } else {
                            if (stream.factionsMap[filterStreamFaction]) {
                                allowStream = true;
                            } else if (filterStreamFaction === 'independent' && stream.factionsMap.otherwrp) {
                                allowStream = true;
                            } else {
                                allowStream = false;
                            }
                        }
                    }
                }

                if (allowStream === false) {
                    // Doesn't match required faction
                    streamState = FSTATES.remove;
                } else {
                    channelEl.style.color = useColors[stream.tagFaction];
                    liveElDiv.style.backgroundColor = useColorsDark[stream.tagFaction];
                    liveEl.style.color = useTextColor;

                    if (hoverEl) {
                        hoverEl.style.setProperty('--color-accent', useColors[stream.tagFaction]);
                    }
                    // if (stream.characterName && stream.characterName.includes(']')) {
                    // const titleMatch = stream.characterName.match(/\[(.*?)\]/);
                    // const title = encodeHtml(titleMatch[1]);
                    // const name = stream.characterName.substring(titleMatch.index + title.length + 3);
                    // if (stream.tagText.includes('♛')) title = `♛ ${title}`;
                    // liveEl.innerHTML = encodeHtml(stream.tagText).replace(title, `<span style="color: #4d3537;">${title}</span>`);
                    // } else {
                    liveEl.textContent = stream.tagText;
                    // }

                    if (stream.tagText.startsWith('《')) {
                        liveEl.style.setProperty('margin-left', '-2px');
                    }

                    // For titles, add opacity 0.7 span (?)

                    if (stream.tagFactionSecondary === 'publicnp' || stream.tagFactionSecondary === 'international') {
                        console.log('on', stream.tagFactionSecondary, channelName);
                        liveElDiv.style.backgroundImage = `-webkit-linear-gradient(-60deg, ${useColorsDark[stream.tagFactionSecondary]} 50%, ${useColorsDark[stream.tagFaction]} 50%)`;
                        // liveElDiv.style.backgroundImage = `linear-gradient(to top left, ${liveElDivBgColor} 50%, ${useColorsDark[stream.tagFactionSecondary]} 50%)`;
                    }
                }
            }

            if (streamState === FSTATES.remove || streamState === FSTATES.hide) {
                // Remove stream
                // liveEl.textContent = 'REMOVED';
                // channelEl.style.color = '#ff0074';

                if (viewersNum < minViewersUse && isManualStream === false) {
                    if (isFirstRemove && keepDeleting) {
                        keepDeleting = false;
                        if (stopOnMin) {
                            clearInterval(interval);
                            interval = null;
                            console.log('[TWRPO] Finished.');
                        } else {
                            console.log('[WTRPO] Clearing stream thumbnails with low viewers');
                        }
                    }
                    element.style.visibility = 'hidden';
                    // const images = element.getElementsByClassName('tw-image');
                    // for (let j = 0; j < images.length; j++) images[j].src = '';
                } else if (streamState === FSTATES.hide) {
                    element.style.visibility = 'hidden';
                } else if (keepDeleting) {
                    // element.outerHTML = '';
                    // element.parentNode.removeChild(element);
                    element.style.display = 'none';
                    console.log('[TWRPO] Deleted');
                }
                if (isFirstRemove) isFirstRemove = false;
            } else {
                if (fullDebugging) console.log(`[${dateStr()}] Handled allowed stream: ${channelName}`);
            }
        }

        if (streamCount) {
            if (minLoadedText != null) streamCount.textContent = `Smallest stream on page: ${minLoadedText}`;

            // if (!isUniversalFaction) { // visibility: visible;
            // streamCount.style.visibility = 'visible';
            // } else {
            streamCount.style.visibility = null;
            // }
        }

        if (twrpoScrolling && elements.length > 0 && prevWasZero) {
            const $scrollDiv = $(mainScrollSelector);
            const bottomRem = $scrollDiv[0].scrollHeight - $scrollDiv.height() - $scrollDiv.scrollTop();
            // console.log('after-deletion bottomRem:', bottomRem);
            if (bottomRem < 532) {
                console.log('Auto adjusted scrolling');
                $scrollDiv.scrollTop(Math.max($scrollDiv.scrollTop() - (540 - bottomRem), 0));
            }
        }

        isDeleting = false;
    };

    const startDeleting = () => {
        if (interval != null) {
            clearInterval(interval);
        }
        minLoadedViewers = null;
        minLoadedText = null;
        interval = setInterval(deleteOthers, 1000 * intervalSeconds); // Interval gets ended when minViewers is reached
        deleteOthers();
    };

    const identifyEnglish = () => {
        // Make sure it doesn't run until stream elements (and tags) are fully loaded
        const streamElements = $(targetElementSelector).filter(':visible').toArray();
        for (let i = 0; i < streamElements.length; i++) {
            const streamEl = streamElements[i];
            const channelName = [...streamEl.querySelector(channelNameElementSelector).childNodes]
                .find(node => node.nodeType === 3)
                .textContent.toLowerCase();
            const streamTags = streamEl.querySelectorAll('button.tw-tag');
            if (streamsMap[channelName] && streamTags.length === 1) {
                // Could also just check first tag?
                return streamTags[0].textContent;
            }
        }
        return 'English';
    };

    // Automatically select English tag for RDR2
    const selectEnglish = async () => {
        await waitForElement('div.animated-tag--no-bounce, button[data-a-target="form-tag-add-filter-suggested"]');

        const englishWord = identifyEnglish();

        // console.log('englishWord', englishWord);

        const hasEnglishTag = document.querySelector(`button[data-a-target="form-tag-${englishWord}"]`) != null;

        if (!hasEnglishTag) {
            let englishTag;

            let numAttempts = 0;
            while (englishTag == null) {
                // console.log('Starting attempt to add English tag...');
                const inp = document.querySelector('#dropdown-search-input');
                inp.select();

                // console.log(`Selected dropdown, looking for ${englishWord}`);

                const tagSearchDropdown = $('div.tag-search__scrollable-area:visible')[0];
                const tagSearchContainer = $('div[data-a-target="top-tags-list"]')[0];
                // const searchResults = $('div[aria-label="Search Results"]:visible')[0];
                const isVis1 = tagSearchDropdown != null && tagSearchContainer != null;
                const isReady1 = isVis1 && tagSearchDropdown.querySelector('div.tw-loading-spinner') == null;

                // console.log('Tag dropdown ready:', isVis1, isReady1);

                // eslint-disable-next-line no-await-in-loop
                englishTag = await waitForElement(() => {
                    // const tagSearchDropdownNow = document.querySelector('div.tag-search__scrollable-area');
                    const tagSearchContainerNow = document.querySelector('div[data-a-target="top-tags-list"]');
                    if (!tagSearchContainerNow) return null;
                    const englishXPath = `descendant::div[text()="${englishWord}"]`;
                    // console.log('Looking in tags list for:', englishXPath);
                    const snapshots = document.evaluate(englishXPath, tagSearchContainerNow, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
                    // console.log('Results:', snapshots.snapshotLength, snapshots);
                    if (snapshots.snapshotLength < 1) return null;
                    const item1 = snapshots.snapshotItem(0);
                    // console.log('item1', item1);
                    // if (!item1.title || item1.title === englishWord) return item1;
                    return item1;
                }, 1000);

                const isVis2 = $('div[data-a-target="top-tags-list"]')[0] != null;

                // console.log('English tag:', englishTag, '|', 'Tags list ready:', isVis2);

                if (englishTag == null && isReady1 && isVis2) {
                    numAttempts++;
                    console.log('tag-search appeared', numAttempts);
                }

                if (numAttempts >= 2) {
                    console.log(`failed to find ${englishWord} option in tag-search`);
                    break;
                }
            }

            if (englishTag) {
                englishTag.click();
                console.log(`selected ${englishWord}`);
            }

            $(':focus').blur();
        } else {
            console.log(`has ${englishWord} tag`);
        }
    };

    let destroyFilter;
    let setupFilter;
    let addFactionStreams;

    onSettingChanged = async () => {
        destroyFilter(); // Remove previous buttons/events
        await setupFilter(); // Setup new buttons/events
        resetFiltering(); // Reset twitch elements to original state (npChecked/remove)
        addFactionStreams(undefined); // Add pseudo elements for faction
        startDeleting();
        console.log('Refreshed for setting changes!');
    };

    const addSettings = async () => {
        const followBtn = await waitForElement(settingsTargetElementSelector);
        const $followBtn = $(followBtn);

        if (document.querySelector('.tno-settings-btn') != null) return; // Switching from clips/videos back to channels

        const container = getAncester(followBtn, hopsToSettingsContainerAncestor);
        const $container = $(container);
        const $setEnglishBtn = $('<button>⚙️ Twitch WildRP Only</button>');
        $setEnglishBtn.addClass($followBtn.attr('class'));
        $setEnglishBtn.addClass('tno-settings-btn');
        $setEnglishBtn.css({
            margin: '0 0 0 10px',
            padding: '0 10px',
        });
        $container.append($setEnglishBtn);

        console.log('[TWRPO] Added settings button');

        $setEnglishBtn.click(() => {
            Swal.fire({
                // icon: 'info',
                // title: 'TWRPO Settings',
                html: `
                    <div class="tno-settings-container">
                        <div class="settings-titles">
                            <span class="settings-title">TWRPO Settings</span>
                            <span class="tno-reload settings-reload">&#x27f3;</span>
                        </div>
                        <div class="settings-options">
                            <div class="settings-option">
                                <span class="settings-name bold">Enabled:</span>
                                <span class="settings-value">
                                    <input id="setting-status" type="checkbox" class="toggle" ${twrpoStatus ? 'checked' : ''}>
                                </span>
                            </div>
                            <div class="settings-option">
                                <span class="settings-name"><span class="bold">Show</span> other roleplay servers:</span>
                                <span class="settings-value">
                                    <input id="setting-others" type="checkbox" class="toggle" ${twrpoOthers ? 'checked' : ''}>
                                </span>
                            </div>
                            <div class="settings-option">
                                <span class="settings-name">View search box:</span>
                                <span class="settings-value">
                                    <input id="setting-search" type="checkbox" class="toggle" ${twrpoSearch ? 'checked' : ''}>
                                </span>
                            </div>
                            <div class="settings-option">
                                <span class="settings-name tooltip">Scrolling adjustments:
                                    <span class="tooltiptext tooltiptext-hover">Reduces scrolling lag by making Twitch only fetch one batch of new streams after scrolling to the page bottom.</span>
                                </span>
                                <span class="settings-value">
                                    <input id="setting-scrolling" type="checkbox" class="toggle" ${twrpoScrolling ? 'checked' : ''}>
                                </span>
                            </div>
                            <div class="settings-option">
                                <span class="settings-name">Force "English" only (<em>recommended</em>):</span>
                                <span class="settings-value">
                                    <input id="setting-english" type="checkbox" class="toggle" ${twrpoEnglish ? 'checked' : ''}>
                                </span>
                            </div>
                            <div class="settings-option">
                                <span class="settings-name tooltip">Use custom stream elements instead of filtering:
                                <span class="tooltiptext tooltiptext-hover tooltiptext-wider1">
                                    When you use the "Filter streams" dropdown to view a faction, it works by hiding all streams on the page and creating new custom ones that look the same.
                                    Enabling this setting will use the same system on the default view. The benefit of this is no lag/delay when scrolling down, even to the 1 viewer WildRP streams.
                                    The downside is if you sort streams by Recommended, the order of streams will instead be based on viewcount.<br/>
                                    It could also temporarily break if Twitch updates their site (in which case just disable this setting for a few days).
                                </span>
                                </span>
                                <span class="settings-value">
                                    <input id="setting-custom" type="checkbox" class="toggle" ${twrpoAlwaysCustom ? 'checked' : ''}>
                                </span>
                            </div>
                            <div class="settings-option">
                                <span class="settings-name tooltip">Refresh button updates default view:
                                    <span class="tooltiptext tooltiptext-hover">Clicking the green refresh button while viewing a faction will also refresh the default view. Uses custom stream elements.</span>
                                </span>
                                <span class="settings-value">
                                    <input id="setting-reload-def" type="checkbox" class="toggle" ${twrpoReloadDefault ? 'checked' : ''}>
                                </span>
                            </div>
                            ${
    isDeveloper
        ? `
                            <div class="settings-option">
                                <span class="settings-name">Enable filtering</span>
                                <span class="settings-value">
                                    <input id="setting-show-all" type="checkbox" class="toggle" ${!twrpoAllowAll ? 'checked' : ''}>
                                </span>
                            </div>
                            `
        : ''
}
                        </div>
                    </div>
                `,
                heightAuto: false,
                width: 'auto',
                // confirmButtonText: 'Close',
                showConfirmButton: false,
                didOpen: () => {
                    const $settingsReload = $('.settings-reload');
                    const $settingStatus = $('#setting-status');
                    const $settingEnglish = $('#setting-english');
                    const $settingSearch = $('#setting-search');
                    const $settingScrolling = $('#setting-scrolling');
                    const $settingOthers = $('#setting-others');
                    const $settingCustom = $('#setting-custom');
                    const $settingReloadDef = $('#setting-reload-def');
                    const $settingShowAll = $('#setting-show-all');

                    $settingsReload.click(() => window.location.reload());

                    $settingStatus.change(function () {
                        const newValue = this.checked;
                        setStorage('twrpoStatus', newValue);
                        twrpoStatus = newValue;
                        console.log('Set status to:', newValue);
                    });

                    $settingEnglish.change(function () {
                        const newValue = this.checked;
                        setStorage('twrpoEnglish', newValue);
                        twrpoEnglish = newValue;
                        console.log('Set force-english to:', newValue);
                    });

                    $settingSearch.change(function () {
                        const newValue = this.checked;
                        setStorage('twrpoSearch', newValue);
                        twrpoSearch = newValue;
                        console.log('Set view-search to:', newValue);
                        onSettingChanged();
                    });

                    $settingScrolling.change(function () {
                        const newValue = this.checked;
                        setStorage('twrpoScrolling', newValue);
                        twrpoScrolling = newValue;
                        console.log('Set scrolling-adjustments to:', newValue);
                        onSettingChanged();
                    });

                    $settingOthers.change(function () {
                        const newValue = this.checked; // Reverse for remove
                        setStorage('twrpoOthers', newValue);
                        twrpoOthers = newValue;
                        console.log('Set include-others to:', newValue);
                        onSettingChanged();
                    });

                    $settingCustom.change(function () {
                        const newValue = this.checked;
                        setStorage('twrpoAlwaysCustom', newValue);
                        twrpoAlwaysCustom = newValue;
                        alwaysRoll = newValue;
                        realViews = REAL_VIEWS.get(alwaysRoll);
                        if (newValue === false) rollStart = 0;
                        console.log('Set always-custom to:', newValue);
                        onSettingChanged();
                    });

                    $settingReloadDef.change(function () {
                        const newValue = this.checked;
                        setStorage('twrpoReloadDefault', newValue);
                        twrpoReloadDefault = newValue;
                        console.log('Set reload-default to:', newValue);
                        onSettingChanged();
                    });

                    if ($settingShowAll) {
                        $settingShowAll.change(function () {
                            const newValue = !this.checked;
                            setStorage('twrpoAllowAll', newValue);
                            twrpoAllowAll = newValue;
                            console.log('Set show-all to:', newValue);
                            onSettingChanged();
                        });
                    }
                },
            });
        });
    };

    const makeScrollEvent = (lastEl) => {
        console.log('Making scroll event for:', lastEl);

        const options = {
            root: document.documentElement,
        };

        let observer;

        // eslint-disable-next-line prefer-const
        observer = new IntersectionObserver((entries, observer) => {
            entries.forEach((entry) => {
                if (entry.intersectionRatio > 0) {
                    observer.unobserve(lastEl);
                    console.log('Fetching next batch of streams');
                    addFactionStreams(undefined, true);
                }
            });
        }, options);

        observer.observe(lastEl);
    };

    // eslint-disable-next-line prefer-const
    addFactionStreams = (streams = undefined, continueRoll = false) => {
        if (live === undefined) {
            console.log('Faction filter failed - Streams not fetched yet...');
            return;
        }

        let useRoll = false;
        if (onDefaultView() && (alwaysRoll || rollStart > 0)) {
            useRoll = true;
            if (!continueRoll) rollStart = 0;
        }

        const rollIds = [];

        if (streams === undefined) {
            streams = live.streams;

            if (isFilteringText) {
                streams = streams.filter(stream => matchesFilterStreamText(stream));
            }

            if (isFilteringText === false) { // !onUniversalFaction()
                if (useRoll) {
                    const numStreams = streams.length;
                    let numAdded = 0;
                    const results = [];
                    while (numAdded < rollAddMax && rollStart < numStreams) {
                        const idx = rollStart;
                        const stream = streams[idx];
                        rollStart++;
                        // Given stream is acceptable...
                        results.push(stream);
                        rollIds.push(idx);
                        numAdded++;
                    }
                    streams = results;
                } else {
                    streams = streams.filter((stream) => {
                        if (['publicnp', 'international'].includes(filterStreamFaction)) {
                            return stream.tagFactionSecondary === filterStreamFaction;
                        }
                        if (stream.factionsMap[filterStreamFaction]) return true;
                        if (filterStreamFaction === 'independent' && stream.factionsMap.otherwrp) return true;
                        return false;
                    });
                }
            }
        }

        console.log('filtered streams:', streams);

        const baseEl = document.querySelector(insertionElementSelector);
        const baseParent = baseEl.parentElement;
        const wasRoll = rollIds.length > 0;

        for (let i = 0; i < streams.length; i++) {
            const idx = wasRoll ? rollIds[i] : i;
            const stream = streams[i];
            const cloneHtml = makeStreamHtml(stream, idx);
            baseEl.insertAdjacentHTML('beforebegin', cloneHtml);
            const streamEl = baseParent.querySelector(`#tno-stream-${idx}`);
            if (wasRoll && i === streams.length - 1) {
                makeScrollEvent(streamEl);
            }
        }
    };

    const fixReloadEnabled = () => {
        const filterReloadBtn = document.querySelector('.filter-reload');
        const isDefaultView = onDefaultView();
        const isRealView = onRealView() && !isDefaultView; // all-twitch
        const showOnDefaultNow = isDefaultView && (alwaysRoll || twrpoReloadDefault);

        if (isFilteringText || showOnDefaultNow || (isRealView === false && isDefaultView === false)) { // Filtering text or showable-on-default or not universal
            removeClass(filterReloadBtn, 'tno-hide', 'tno-other'); // Full button
        } else {
            if (isDefaultView) {
                removeClass(filterReloadBtn, 'tno-hide'); // Partial (dark-green) button
                addClass(filterReloadBtn, 'tno-other');
            } else {
                removeClass(filterReloadBtn, 'tno-other'); // Red button
                addClass(filterReloadBtn, 'tno-hide');
            }
        }
    };

    destroyFilter = () => {
        const filterDiv = document.querySelector('.tno-filter-options');
        if (!filterDiv) return;
        for (const eventListener of filterListeners) {
            const { el, evName, evFunc } = eventListener;
            el.removeEventListener(evName, evFunc); // try catch
        }
        filterListeners = [];
        const searchDiv = document.querySelector('.tno-search-div');
        filterDiv.remove();
        if (searchDiv) searchDiv.remove();
    };

    const addFilterListener = (el, evName, evFunc) => {
        el.addEventListener(evName, evFunc);
        filterListeners.push({ el, evName, evFunc });
    };

    const activateSelect = (selectFirst = false) => {
        const elSelectCustom = document.getElementsByClassName('js-selectCustom')[0];
        // const elSelectCustomBox = elSelectCustom.children[0];
        const elSelectCustomBox = elSelectCustom.getElementsByClassName('selectCustom-trigger')[0];
        const elSelectCustomOpts = elSelectCustom.children[1];
        const elSelectCustomInput = elSelectCustomOpts.children[0];
        const customOptsList = Array.from(elSelectCustomOpts.children);
        const optionsCount = customOptsList.length;
        const filterReloadBtn = elSelectCustom.querySelector('.filter-reload');

        let optionChecked = null;
        let optionHoveredIndex = 0;
        let closeSelectCustom;

        const updateCustomSelectHovered = (newIndex) => {
            const prevOption = elSelectCustomOpts.children[optionHoveredIndex];
            let option = elSelectCustomOpts.children[newIndex];

            const direction = newIndex - optionHoveredIndex;
            if (option.style.display === 'none' && direction !== 0) {
                let newIndex2 = newIndex;
                let option2 = option;
                while (newIndex2 > 1 && newIndex2 < optionsCount - 1) {
                    newIndex2 += direction;
                    option2 = elSelectCustomOpts.children[newIndex2];
                    if (option2.style.display !== 'none') {
                        newIndex = newIndex2;
                        option = option2;
                        break;
                    }
                }
            }

            if (option.style.display === 'none') return;

            if (prevOption) {
                prevOption.classList.remove('isHover');
            }
            if (option) {
                option.classList.add('isHover');
            }

            optionHoveredIndex = newIndex;
        };

        const watchClickOutside = (e) => {
            // console.log('Event happened: watchClickOutside');
            const didClickedOutside = !elSelectCustom.contains(e.target);
            if (didClickedOutside) {
                closeSelectCustom();
            }
        };

        const inputHandler = (searchText = '') => {
            const searchTextLower = searchText.toLowerCase();
            customOptsList.forEach((elOption, index) => {
                if (index === 0) return;
                if (elOption.textContent.toLowerCase().includes(searchTextLower)) {
                    elOption.style.display = null;
                } else {
                    elOption.style.display = 'none';
                }
            });
        };

        const updateCustomSelectChecked = async (value, text, isInit = false) => {
            const prevValue = optionChecked;

            const elPrevOption = elSelectCustomOpts.querySelector(`[data-value="${prevValue}"`);
            const elOption = elSelectCustomOpts.querySelector(`[data-value="${value}"`);

            if (elPrevOption) {
                elPrevOption.classList.remove('isActive');
            }

            if (elOption) {
                elOption.classList.add('isActive');
            }

            elSelectCustomBox.textContent = text;
            elSelectCustomBox.style.color = elOption.style.color;
            optionChecked = value;

            filterStreamFaction = value;
            fixReloadEnabled();

            if (isInit) return;

            elSelectCustomInput.value = '';
            console.log('Updated selected!', filterStreamFaction);
            inputHandler();
            resetFiltering();
            // if (filterStreamFaction !== 'cleanbois') return;
            console.log('FOUND live:', live ? live.streams.length : -1);
            addFactionStreams();
            startDeleting();
        };

        const supportKeyboardNavigation = (e) => {
            // console.log('Key pressed');
            // press down -> go next
            if (e.keyCode === 40 && optionHoveredIndex < optionsCount - 1) {
                e.preventDefault(); // prevent page scrolling
                updateCustomSelectHovered(optionHoveredIndex + 1);
            }

            // press up -> go previous
            if (e.keyCode === 38 && optionHoveredIndex > 1) {
                e.preventDefault(); // prevent page scrolling
                updateCustomSelectHovered(optionHoveredIndex - 1);
            }

            // press Enter or space -> select the option
            if (e.keyCode === 13) {
                // space: 32
                e.preventDefault();

                const option = elSelectCustomOpts.children[optionHoveredIndex];
                const value = option && option.getAttribute('data-value');

                if (value) {
                    updateCustomSelectChecked(value, option.textContent);
                }
                closeSelectCustom();
            }

            // press ESC -> close selectCustom
            if (e.keyCode === 27) {
                closeSelectCustom();
            }
        };

        const openSelectCustom = () => {
            elSelectCustom.classList.add('isActive');
            // Remove aria-hidden in case this was opened by a user
            // who uses AT (e.g. Screen Reader) and a mouse at the same time.
            elSelectCustom.setAttribute('aria-hidden', false);

            if (optionChecked) {
                const optionCheckedIndex = customOptsList.findIndex(el => el.getAttribute('data-value') === optionChecked);
                updateCustomSelectHovered(optionCheckedIndex);
            }

            // Add related event listeners
            addFilterListener(document, 'click', watchClickOutside);
            addFilterListener(document, 'keydown', supportKeyboardNavigation);

            elSelectCustomInput.focus();
        };

        closeSelectCustom = () => {
            elSelectCustom.classList.remove('isActive');

            elSelectCustom.setAttribute('aria-hidden', true);

            updateCustomSelectHovered(0);

            // Remove related event listeners
            document.removeEventListener('click', watchClickOutside);
            document.removeEventListener('keydown', supportKeyboardNavigation);
        };

        // Toggle custom select visibility when clicking the box
        // eslint-disable-next-line prefer-arrow-callback
        addFilterListener(elSelectCustomBox, 'click', function (e) {
            // console.log('Clicked select box');
            const isClosed = !elSelectCustom.classList.contains('isActive');

            if (isClosed) {
                openSelectCustom();
            } else {
                closeSelectCustom();
            }
        });

        // Update selectCustom value when an option is clicked or hovered
        customOptsList.forEach((elOption, index) => {
            if (index === 0) return;

            // eslint-disable-next-line prefer-arrow-callback
            addFilterListener(elOption, 'click', function (e) {
                // console.log('Clicked option');
                const value = e.target.getAttribute('data-value');

                updateCustomSelectChecked(value, e.target.textContent);
                closeSelectCustom();
            });

            // eslint-disable-next-line prefer-arrow-callback
            addFilterListener(elOption, 'mouseenter', function (e) {
                // console.log('Mouse entered option');
                updateCustomSelectHovered(index);
            });

            // TODO: Toggle these event listeners based on selectCustom visibility
        });

        // eslint-disable-next-line prefer-arrow-callback
        addFilterListener(elSelectCustomInput, 'input', function (e) {
            // console.log('Input entered');
            inputHandler(e.target.value);
        });

        // eslint-disable-next-line prefer-arrow-callback
        addFilterListener(filterReloadBtn, 'click', async function (e) {
            console.log('Refreshing streams...');
            timeId = `?${new Date().getTime()}`;
            rollStart = 0;
            if (onDefaultView() || twrpoReloadDefault) {
                alwaysRoll = true;
                realViews = REAL_VIEWS.get(alwaysRoll);
            }
            destroyFilter(); // Remove previous buttons/events
            await requestLiveData(); // Fetch new data from API endpoint
            await setupFilter(); // Setup new buttons/events
            resetFiltering(); // Reset twitch elements to original state (npChecked/remove)
            addFactionStreams(undefined); // Add pseudo elements for faction
            startDeleting();
            console.log('Refresh complete!');
        });

        if (selectFirst) {
            const initOption = elSelectCustomOpts.querySelector(`[data-value="${filterStreamFaction}"`);
            const initOptionValue = initOption.getAttribute('data-value');
            const initOptionText = initOption.textContent;
            updateCustomSelectChecked(initOptionValue, initOptionText, true);
        }
    };

    const parseLookup = (text, retainCase = false) => {
        text = text.replace(/^\W+|\W+$|[^\w\s]+/g, ' ').replace(/\s+/g, ' ');
        if (!retainCase) text = text.toLowerCase();
        return text.trim();
    };

    let inputNumLast = 0;
    let lastResultsStr;

    const searchForStreams = (searchText) => {
        const inputNumNow = ++inputNumLast;
        filterStreamText = searchText;
        filterStreamTextLookup = parseLookup(searchText);
        isFilteringText = filterStreamText !== '';
        console.log('Filtering for:', filterStreamText);

        const factionStreams = isFilteringText ? live.streams.filter(stream => matchesFilterStreamText(stream)) : undefined;
        const nowResultsStr = JSON.stringify(factionStreams);
        if (nowResultsStr === lastResultsStr) return;

        const numResults = factionStreams ? factionStreams.length : 0;

        let waitMs = 560; // 560

        if (numResults === 0) {
            waitMs = 0;
        } else if (numResults <= 6) {
            waitMs = 100; // 100
        } else if (numResults <= 12) {
            waitMs = 185; // 185
        } else if (numResults <= 18) {
            waitMs = 260; // 260
        } else if (numResults <= 24) {
            waitMs = 335; // 335
        } else if (numResults <= 30) {
            waitMs = 410; // 410
        }

        setTimeout(() => {
            if (inputNumNow !== inputNumLast || nowResultsStr === lastResultsStr) {
                console.log('Cancelled search for', searchText);
                return;
            }
            lastResultsStr = nowResultsStr;
            console.log(`(${waitMs}) Filtering...`);
            fixReloadEnabled();
            resetFiltering();
            // if (filterStreamFaction !== 'cleanbois') return;
            if (onRealView() === false) { // Runs in all cases except on real view
                addFactionStreams(factionStreams);
            }
            startDeleting();
        }, waitMs);
    };

    const genDefaultFaction = () => {
        let baseWord = 'WildRP';
        const flagWords = [];
        if (twrpoOthers) baseWord = 'RP';
        return `All ${baseWord}${flagWords.join('')} (Default)`;
    };

    const setupFilterFactions = async () => {
        const $sortByLabel = $(await waitForElement('label[for="browse-header-filter-by"]'));
        const $sortByDiv = $sortByLabel.parent().parent();
        const $groupDiv = $sortByDiv.parent();
        const $filterDiv = $sortByDiv.clone();

        $filterDiv.insertBefore($sortByDiv);
        $filterDiv.addClass('tno-filter-options');
        $filterDiv.css({ marginRight: '15px' });

        const [$labelDiv, $dropdownDiv] = $filterDiv
            .children()
            .toArray()
            .map(el => $(el));

        const filterFactions = live.filterFactions;
        filterFactions[0][1] = genDefaultFaction();

        if (isDeveloper) {
            const guessedIdx = filterFactions.findIndex(data => data[0] === 'guessed');
            if (guessedIdx && filterFactions[guessedIdx][2] === true) {
                const guessed = filterFactions.splice(guessedIdx, 1)[0];
                filterFactions.splice(2, 0, guessed);
            }
        }

        filterFactions.sort((dataA, dataB) => {
            const emptyA = dataA[2] === false;
            const emptyB = dataB[2] === false;
            if (emptyA && !emptyB) return 1;
            if (emptyB && !emptyA) return -1;
            return 0;
        });

        console.log('>>>>>>>>>>>> setup filter');

        const showOnDefault = alwaysRoll || twrpoReloadDefault;

        // const isRealView = onRealView();

        // $labelDiv.find('label').text('Filter factions');
        $labelDiv.remove();
        $dropdownDiv.html(`
            <div class="select">
                <div class="selectWrapper">
                    <div class="selectCustom js-selectCustom" aria-hidden="true">
                        <div class="selectCustom-row${!isDark ? ' lightmodeScreen' : ''}">
                            <div class="filter-reload-box tooltip">
                                <span id="tno-reload-message" class="tooltiptext tooltiptext-hover tooltiptext-wider2">
                                    Refresh live WildRP data —<br/>
                                    Click once to update streams on all filters${(alwaysRoll || showOnDefault) ? ` and the default view.<br/><br/>
                                    To stop the default view being refreshed, use the settings menu<br/>
                                    (⚙️ Twitch WildRP Only button).
                                    ` : `.<br/><br/>
                                    This will only refresh the default view when clicked without viewing a faction<br/>(dark green refresh button).<br/><br/>
                                    To make the refresh button always update the default view, use the settings menu<br/>
                                    (⚙️ Twitch WildRP Only button).
                                    `}
                                </span>
                                <span class="tno-reload filter-reload">&#x27f3;</span>
                            </div>
                            <label class="selectCustom-label tooltip">
                                Filter streams
                                <span id="streamCount" class="tooltiptext tooltiptext2">...</span>
                            </label>
                            <div class="selectCustom-trigger"></div>
                        </div>
                        <div class="selectCustom-options">
                            <input class="selectCustom-input" placeholder="Search..."></input>
                            ${filterFactions
        .map(
            option =>
                `<div style="color: ${useColorsDark[option[0]] || useColorsDark.independent}" class="selectCustom-option${
                    option[2] === false ? ' optionNotLive' : ''
                }" data-value="${option[0]}">${option[1]}${option[2] === false ? ' (Not Live)' : ''}</div>`
        )
        .join('')}
                        </div>
                    </div>
                </div>
            </div>
        `);

        activateSelect(true);

        return [$groupDiv, $filterDiv];
    };

    // eslint-disable-next-line prefer-const
    setupFilter = async () => {
        const [$groupDiv] = await setupFilterFactions();

        if (twrpoSearch) {
            $groupDiv.css({ position: 'relative' });

            const $searchDiv = $('<div class="tno-search-div"></div>');
            const $searchInput = $searchDiv.append(`<input class="tno-search-input${isDark ? '' : ' tno-search-input-lightmode'}" placeholder="Search for character name / nickname / stream..."/>`);
            $groupDiv.prepend($searchDiv);

            if (isFilteringText) document.querySelector('.tno-search-input').value = filterStreamText;

            // eslint-disable-next-line prefer-arrow-callback
            addFilterListener($searchInput[0], 'input', function (e) {
                const searchText = e.target.value.toLowerCase().trim();

                const textLen = searchText.length;

                if (searchText === '' || textLen >= 2) {
                    searchForStreams(searchText);
                }
            });
        }
    };

    onPage = twitchRdr2Url.test(window.location.href);

    activateInterval = async () => {
        // Remember that this will run twice without reloading when switching from Clips/Videos back to channels
        if (interval != null) {
            console.log("[TWRPO] Couldn't start interval (already running)");
            return false;
        }

        await fixSortType();

        [twrpoStatus, twrpoEnglish, twrpoOthers, twrpoSearch, twrpoScrolling, twrpoAlwaysCustom, twrpoReloadDefault, twrpoAllowAll] = await getStorage([
            ['twrpoStatus', true],
            ['twrpoEnglish', true],
            ['twrpoOthers', false],
            ['twrpoSearch', true],
            ['twrpoScrolling', false],
            ['twrpoAlwaysCustom', false],
            ['twrpoReloadDefault', sortType !== SORTS.recommended],
            ['twrpoAllowAll', false],
        ]);

        alwaysRoll = twrpoAlwaysCustom;
        realViews = REAL_VIEWS.get(alwaysRoll);
        rollStart = 0;

        addSettings(); // Settings should show even if status disabled

        if (twrpoStatus === false) {
            console.log("[TWRPO] Couldn't start interval (status set to disabled)");
            return false;
        }

        filterStreamFaction = 'allwildrp';

        if (twrpoEnglish) {
            selectEnglish();
        }

        setupFilter();

        if (alwaysRoll) {
            await waitForElement(insertionElementSelector);
            addFactionStreams(undefined);
        }

        console.log('[TWRPO] Starting interval');
        startDeleting();

        return true;
    };

    stopInterval = () => {
        if (interval == null) {
            console.log("[TRWPO] Couldn't stop interval (already ended)");
            return false;
        }

        console.log('[TWRP] Stopping interval');
        clearInterval(interval);
        interval = null;

        return true;
    };

    setTimeout(() => {
        if (onPage) {
            activateInterval();
        }
    }, 1000);
};

filterStreams();

// Twitch switches page without any reloading:
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[TWRPO] PAGE STATUS:', request);
    if (request.status === 'START') {
        onPage = true;
        if (activateInterval != null) activateInterval();
    } else if (request.status === 'STOP') {
        onPage = false;
        if (stopInterval != null) stopInterval();
    }
});
