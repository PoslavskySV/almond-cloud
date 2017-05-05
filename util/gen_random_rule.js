// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const stream = require('stream');

const ThingTalk = require('thingtalk');

const db = require('./db');

function sample(distribution) {
    var keys = Object.keys(distribution);
    var sums = new Array(keys.length);
    var rolling = 0;
    for (var i = 0; i < keys.length; i++) {
        sums[i] = rolling + distribution[keys[i]];
        rolling = sums[i];
    }

    var total = sums[keys.length-1];
    var choice = Math.random() * total;

    for (var i = 0; i < keys.length; i++) {
        if (choice <= sums[i])
            return keys[i];
    }
    return keys[keys.length-1];
}

function uniform(array) {
    return array[Math.floor(Math.random()*array.length)];
}

function coin(bias) {
    return Math.random() < bias;
}

const COMPOSITION_WEIGHTS = {
    'trigger+null+action': 1.5,
    'null+query+action': 1,
    'trigger+null+query': 0.5,
    'trigger+action+query': 0
//    'trigger+null+null': 1,
//    'null+query+null': 1,
//    'null+null+action': 1,
};

// Rakesh : removed 'github'
const FIXED_KINDS = ['washington_post', 'sportradar', 'giphy',
    'yahoofinance', 'nasa', 'twitter', 'facebook', 'instagram',
    'linkedin', 'youtube', 'lg_webos_tv', 'light-bulb',
    'thermostat', 'security-camera', 'heatpad', 'phone',
    'omlet', 'slack', 'gmail', 'thecatapi'];

const FIXED_KINDS2 = ['sportradar', 'slack', 'phone'];
//FIXED_KINDS.push('tumblr');
//FIXED_KINDS.push('tumblr-blog');

const DOMAIN_WEIGHTS = {
    media: 100,
    home: 54,
    'social-network': 70,
    communication: 57,
    'data-management': 38,
    health: 26,
    service: 59
};

const DOMAINS = {
    home: ['heatpad', 'car', 'security-camera', 'speaker', 'light-bulb', 'smoke-alarm', 'thermostat'],
    'social-network': ['tumblr-blog'],
    health: ['scale', 'activity-tracker', 'fitness-tracker', 'heartrate-monitor', 'sleep-tracker'],
    communication: [],
    'data-management': [],
    media: [],
    service: []
};

const INVERTED_DOMAINS = {};

for (let domain in DOMAINS) {
    for (let kind of DOMAINS[domain])
        INVERTED_DOMAINS[kind] = domain;
}

function getSchemaDomain(schema) {
    if (schema.domain)
        return schema.domain;

    if (INVERTED_DOMAINS[schema.kind])
        return INVERTED_DOMAINS[schema.kind];

    return 'service';
}

function chooseSchema(allSchemas, policy) {
    if (policy.startsWith('only-'))
        return policy.substr('only-'.length);

    if (policy === 'uniform')
        return uniform(allSchemas).kind;

    if (policy === 'uniform-fixed-kinds')
        return uniform(FIXED_KINDS);
    if (policy === 'test')
        return uniform(FIXED_KINDS2);

    if (policy === 'weighted-domain') {
        var domains = {
            home: [],
            'social-network': [],
            health: [],
            'communication': [],
            'data-management': [],
            media: [],
            service: []
        };

        for (var schema of allSchemas)
            domains[getSchemaDomain(schema)].push(schema);

        return uniform(domains[sample(DOMAIN_WEIGHTS)]).kind;
    }

    throw new Error('Unknown sampling policy ' + policy);
}

function getAllSchemas(dbClient) {
    return db.selectAll(dbClient,
          " (select ds.*, dck.kind as domain from device_schema ds, device_class dc, device_class_kind dck"
        + "  where ds.kind = dc.global_name and dc.id = dck.device_id and ds.approved_version is not null and dck.kind"
        + "  in ('media', 'home', 'social-network', 'communication', 'data-management', 'health', 'service'))"
        + " union"
        + " (select ds.*, null from device_schema ds where ds.kind_type = 'other' and ds.approved_version is not null)");
}

function chooseChannel(schemaRetriever, kind, form) {
    return schemaRetriever.getFullMeta(kind).then((fullMeta) => {
        var options = [];
        if (form[0] !== 'null' && Object.keys(fullMeta['triggers']).length !== 0) options.push('trigger');
        if (form[1] !== 'null' && Object.keys(fullMeta['queries']).length !== 0) options.push('query');
        if (form[2] !== 'null' && Object.keys(fullMeta['actions']).length !== 0) options.push('action');
        if (options.length === 0)
            return 'null';
        else
            return uniform(options);
    });
}

function chooseInvocation(schemaRetriever, schemas, samplingPolicy, channelType) {
    var kind = chooseSchema(schemas, samplingPolicy);
    return schemaRetriever.getFullMeta(kind).then((fullMeta) => {
        var channels = fullMeta[channelType];
        var choices = Object.keys(channels);
        if (choices.length === 0) // no channels of this type for this schema, try again
            return chooseInvocation(schemaRetriever, schemas, samplingPolicy, channelType);

        var channelName = uniform(choices);
        channels[channelName].kind = kind;
        channels[channelName].name = channelName;
        return channels[channelName];
    });
}

function chooseRule(schemaRetriever, schemas, samplingPolicy) {
    var form = sample(COMPOSITION_WEIGHTS).split('+');
    var trigger, query, action;
    if (!samplingPolicy.startsWith('only-')) {
        trigger = form[0] === 'null' ? undefined : chooseInvocation(schemaRetriever, schemas, samplingPolicy, 'triggers');
        query = form[1] === 'null' ? undefined : chooseInvocation(schemaRetriever, schemas, samplingPolicy, 'queries');
        action = form[2] === 'null' ? undefined : chooseInvocation(schemaRetriever, schemas, samplingPolicy, 'actions');
        return Q.all([trigger, query, action]);
    } else {
        var kind = samplingPolicy.substr('only-'.length);
        trigger = form[0] === 'null' ? undefined : chooseInvocation(schemaRetriever, schemas, 'uniform', 'triggers');
        query = form[1] === 'null' ? undefined : chooseInvocation(schemaRetriever, schemas, 'uniform', 'queries');
        action = form[2] === 'null' ? undefined : chooseInvocation(schemaRetriever, schemas, 'uniform', 'actions');
        return chooseChannel(schemaRetriever, kind, form).then((channel) => {
            if (channel === 'trigger')
                trigger = chooseInvocation(schemaRetriever, schemas, samplingPolicy, 'triggers');
            else if (channel === 'query')
                query = chooseInvocation(schemaRetriever, schemas, samplingPolicy, 'queries');
            else if (channel === 'action')
                action = chooseInvocation(schemaRetriever, schemas, samplingPolicy, 'actions');
            else {
                return chooseRule(schemaRetriever, schemas, samplingPolicy);
            }
            return Q.all([trigger, query, action]);
        });
    }
}

const NUMBER_OP_WEIGHTS = {
    'is': 0.5,
    '>': 1,
    '<': 1,
    '': 2
};

const ARRAY_OP_WEIGHTS = {
    'has': 1,
    '': 2
};

const STRING_OP_WEIGHTS = {
    'is': 1,
    'contains': 1,
    '': 2
};

const OTHER_OP_WEIGHTS = {
    'is': 1,
    '': 2
};

const STRING_ARGUMENTS = ["i'm happy", "you would never believe what happened", "merry christmas", "love you"];
const USERNAME_ARGUMENTS = ['alice'];
const HASHTAG_ARGUMENTS = ['funny', 'cat', 'lol'];
const URL_ARGUMENTS = ['http://www.abc.def'];
const NUMBER_ARGUMENTS = [42, 7, 14, 11];
const MEASURE_ARGUMENTS = {
    C: [{ value: 73, unit: 'F' }, { value: 22, unit: 'C' }],
    m: [{ value: 1000, unit: 'm' }, { value: 42, unit: 'cm' }],
    kg: [{ value: 82, unit: 'kg' }, { value: 155, unit: 'lb' }],
    kcal: [{ value: 500, unit: 'kcal' }],
    mps: [{ value: 5, unit: 'kmph' }, { value: 25, unit: 'mph' }],
    ms: [{ value: 2, unit: 'h'}],
    byte: [{ value: 5, unit: 'KB' }, { value: 20, unit: 'MB' }]
};
const BOOLEAN_ARGUMENTS = [true, false];
const LOCATION_ARGUMENTS = [{ relativeTag: 'rel_current_location', latitude: -1, longitude: -1 },
                            { relativeTag: 'rel_home', latitude: -1, longitude: -1 },
                            { relativeTag: 'rel_work', latitude: -1, longitude: -1 }];
                            //{ relativeTag: 'absolute', latitude: 37.442156, longitude: -122.1634471 },
                            //{ relativeTag: 'absolute', latitude:    34.0543942, longitude: -118.2439408 }];
const DATE_ARGUMENTS = [{ year: 2017, month: 2, day: 14, hour: -1, minute: -1, second: -1 },
    { year: 2016, month: 5, day: 4, hour: -1, minute: -1, second: -1 }];
const EMAIL_ARGUMENTS = ['bob@stanford.edu'];
const PHONE_ARGUMENTS = ['+16501234567'];

const ENTITIES = {
    'sportradar:eu_soccer_team': [["Juventus", "juv"], ["Barcellona", "bar"], ["Bayern Munchen", "fcb"]],
    'sportradar:mlb_team': [["SF Giants", 'sf'], ["Chicago Cubs", 'chc']],
    'sportradar:nba_team': [["Golden State Warriors", 'gsw'], ["LA Lakers", 'lal']],
    'sportradar:ncaafb_team': [["Stanford Cardinals", 'sta'], ["California Bears", 'cal']],
    'sportradar:ncaambb_team': [["Stanford Cardinals", 'stan'], ["California Bears", 'cal']],
    'sportradar:nfl_team': [["Seattle Seahawks", 'sea'], ["SF 49ers", 'sf']],
    'sportradar:us_soccer_team': [["San Jose Earthquakes", 'sje'], ["Toronto FC", 'tor']],
    'tt:stock_id': [["Google", 'goog'], ["Apple", 'aapl'], ['Microsoft', 'msft']]
};

// params with special value
const PARAMS_SPECIAL_STRING = {
    'repo_name': 'android_repository',
    'file_name': 'log.txt',
    'old_name': 'log.txt',
    'new_name': 'backup.txt',
    'folder_name': 'archive',
    'purpose': 'research project',
    'fileter': 'lo-fi',
    'query': 'super bowl',
    'summary': 'celebration',
    'category': 'sports',
    'from_name': 'bob',
    'blog_name': 'government secret',
    'camera_used': 'mastcam',
    'description': 'christmas',
    'source_language': 'english',
    'target_language': 'chinese',
    'detected_language': 'english',
    'organizer': 'stanford',
    'user': 'bob',
    'positions': 'ceo',
    'specialties': 'java',
    'industry': 'music',
    'template': 'wtf',
    'text_top': 'ummm... i have a question...',
    'text_bottom': 'wtf?',
    'phase': 'moon'
};

// params should never be assigned unless it's required
const PARAMS_BLACK_LIST = [
    'company_name', 'weather', 'currency_code', 'orbiting_body',
    'home_name', 'away_name', 'home_alias', 'away_alias',
    'watched_is_home', 'scheduled_time', 'game_status',
    'home_points', 'away_points', // should be replaced by watched_points, other_points eventually
    'day',
    'bearing', 'updateTime', //gps
    'deep', 'light', 'rem', 'awakeTime', 'asleepTime', // sleep tracker
    'yield', 'div', 'pay_date', 'ex_div_date', // yahoo finance
    'cloudiness', 'fog',
    'formatted_name', 'headline', // linkedin
    'video_id',
    'image_id',
    '__reserved', // twitter
    'uber_type',
    'count',
    'timestamp', //slack
    'last_modified', 'full_path', 'total', // dropbox
    'estimated_diameter_min', 'estimated_diameter_max',
    'translated_text',
    'sunset', 'sunrise',
    'name' //nasa, meme
];

// params should use operator is
const PARAMS_OP_IS = [
    'filter', 'source_language', 'target_language', 'detected_language',
    'from_name', 'uber_type',
];

// params should use operator contain
const PARAMS_OP_CONTAIN = [
    'snippet'
];

// params should use operator greater
const PARAMS_OP_GREATER = [
    'file_size'
];

// rhs params should not be assigned by a value from lhs
const PARAMS_BLACKLIST_RHS = [
    'file_name', 'new_name', 'old_name', 'folder_name', 'repo_name',
    'home_name', 'away_name', 'purpose'
];

// lhs params should not be assigned to a parameter in the rhs
const PARAMS_BLACKLIST_LHS = [
    'orbiting_body', 'camera_used'
];

function chooseEntity(entityType) {
    if (entityType === 'tt:email_address')
        return ['EmailAddress', { value: uniform(EMAIL_ARGUMENTS) }];
    if (entityType === 'tt:phone_number')
        return ['PhoneNumber', { value: uniform(PHONE_ARGUMENTS) }];
    if (entityType === 'tt:username')
        return ['Username', { value: uniform(USERNAME_ARGUMENTS) }];
    if (entityType === 'tt:hashtag')
        return ['Hashtag', { value: uniform(HASHTAG_ARGUMENTS) }];
    if (entityType === 'tt:url')
        return ['URL', { value: uniform(URL_ARGUMENTS) }];
    if (entityType === 'tt:picture')
        return [null, null];

    var choices = ENTITIES[entityType];
    if (!choices) {
        console.log('Unrecognized entity type ' + entityType);
        return [null, null];
    }

    var choice = uniform(choices);
    var v = { value: choice[1], display: choice[0] };
    return ['Entity(' + entityType + ')', v];
}

function chooseRandomValue(argName, type) {
    if (type.isArray)
        return chooseRandomValue(argName, type.elem);
    if (type.isString) {
        if (argName in PARAMS_SPECIAL_STRING)
            return ['String', { value: PARAMS_SPECIAL_STRING[argName]}];
        if (argName.endsWith('title'))
            return ['String', { value: 'news' }];
        if (argName.startsWith('label')) // label, labels
            return ['String', { value: 'work' }];
        return ['String', { value: uniform(STRING_ARGUMENTS) }];
    }
    if (type.isHashtag) {
        if (argName === 'channel')
            return ['Hashtag', { value: 'work'}];
        return ['Hashtag', { value: uniform(HASHTAG_ARGUMENTS) }];
    }
    if (type.isNumber) {
        if (argName === 'surge')
            return ['Number', { value : 1.5 }];
        if (argName === 'heartrate')
            return ['Number', { value : 80 }];
        if (argName.startsWith('high'))
            return ['Number', { value : 20 }];
        if (argName.startsWith('low'))
            return ['Number', { value : 10 }];
        return ['Number', { value: uniform(NUMBER_ARGUMENTS) }];
    }
    if (type.isMeasure) {
        if (argName === 'high')
            return ['Measure', { value : 75, unit: 'F' }];
        if (argName === 'low')
            return ['Measure', { value : 70, unit: 'F' }];
        return ['Measure', uniform(MEASURE_ARGUMENTS[type.unit])];
    }
    if (type.isDate)
        return ['Date', uniform(DATE_ARGUMENTS)];
    if (type.isBoolean)
        return ['Bool', { value: uniform(BOOLEAN_ARGUMENTS) }];
    if (type.isLocation) {
        if (argName === 'start')
            return ['Location', { relativeTag: 'rel_home', latitude: -1, longitude: -1 }];
        if (argName === 'end')
            return ['Location', { relativeTag: 'rel_work', latitude: -1, longitude: -1 }];
        return ['Location', uniform(LOCATION_ARGUMENTS)];
    }
    if (type.isEmailAddress)
        return ['EmailAddress', { value: uniform(EMAIL_ARGUMENTS) }];
    if (type.isPhoneNumber)
        return ['PhoneNumber', { value: uniform(PHONE_ARGUMENTS) }];
    if (type.isUsername)
        return ['Username', { value: uniform(USERNAME_ARGUMENTS) }];
    if (type.isURL)
        return ['URL', { value: uniform(URL_ARGUMENTS) }];
    if (type.isEnum)
        return ['Enum', { value: uniform(type.entries) }];
    if (type.isEntity)
        return chooseEntity(type.type);
    if (type.isPicture || type.isTime || type.isAny)
        return [null, null];

    console.log('Invalid type ' + type);
    return [null, null];
}

function getOpDistribution(type) {
    if (type.isNumber || type.isMeasure)
        return NUMBER_OP_WEIGHTS;
    if (type.isArray)
        return ARRAY_OP_WEIGHTS;
    if (type.isString)
        return STRING_OP_WEIGHTS;
    return OTHER_OP_WEIGHTS;
}

function applyFilters(invocation, isAction) {
    if (invocation === undefined)
        return undefined;

    var args = invocation.args;
    var ret = {
        name: { id: 'tt:' + invocation.kind + '.' + invocation.name },
        args: []
    };

    for (var i = 0; i < args.length; i++) {
        var type = ThingTalk.Type.fromString(invocation.schema[i]);
        var argrequired = invocation.required[i];

        if (type.isEntity)
            if (type.type === 'tt:picture')
                continue;
            if (type.type === 'tt:url' && !argrequired)
                continue;
        if (args[i].startsWith('__'))
            continue;
        if (args[i].endsWith('_id') && args[i] !== 'stock_id')
            continue;
        if (!argrequired && PARAMS_BLACK_LIST.indexOf(args[i]) > -1)
            continue;
        if (args[i].startsWith('tournament'))
            continue;
        
        var tmp = chooseRandomValue(args[i], type);
        var sempreType = tmp[0];
        var value = tmp[1];
        if (!sempreType)
            continue;

        // fill in all required one
        if (argrequired) {
            if (coin(0.9)) ret.args.push({ name: { id: 'tt:param.' + args[i] }, operator: 'is', type: sempreType, value: value });
        } else if (isAction) {
            if (coin(0.9)) ret.args.push({ name: { id: 'tt:param.' + args[i] }, operator: 'is', type: sempreType, value: value });
        } else {
            var fill = type.isEnum || coin(0.6);
            if (!fill)
                continue;
            if (PARAMS_OP_IS.indexOf(args[i]) > -1)
                var operator = 'is';
            else if (PARAMS_OP_CONTAIN.indexOf(args[i]) > -1)
                var operator = 'contains';
            else if (PARAMS_OP_GREATER.indexOf(args[i]) > -1)
                var operator = '>';
            else
                var operator = sample(getOpDistribution(type));
            if (operator)
                ret.args.push({ name: { id: 'tt:param.' + args[i] }, operator: operator, type: sempreType, value: value });
        }
    }

    return ret;
}

function applyComposition(from, fromMeta, to, toMeta, isAction) {
    var usedFromArgs = new Set();
    for (var arg of from.args) {
        if (arg.operator === 'is')
            usedFromArgs.add(arg.name.id);
    }
    var usedToArgs = new Set();
    for (var arg of to.args) {
        usedToArgs.add(arg.name.id);
    }

    var fromArgs = fromMeta.args.filter((arg, i) => {
        if (fromMeta.required[i])
            return false;

        if (usedFromArgs.has('tt:param.' + arg))
            return false;

        return true;
    });

    var fromArgMap = {};
    var fromArgRequired = {};
    fromMeta.args.forEach(function(name, i) {
        fromArgMap[name] = ThingTalk.Type.fromString(fromMeta.schema[i]);
        fromArgRequired[name] = fromMeta.required[i];
    });
    var toArgMap = {};
    var toArgRequired = {};
    toMeta.args.forEach(function(name, i) {
        toArgMap[name] = ThingTalk.Type.fromString(toMeta.schema[i]);
        toArgRequired[name] = toMeta.required[i];
    });

    var toArgs = toMeta.args.filter((arg, i) => !usedToArgs.has('tt:param.' + arg));

    for (var toArg of toArgs) {
        var toType = toArgMap[toArg];
        var distribution = {};

        if (toArg.startsWith('__'))
            continue;

        // don't pass numbers
        if (toType.isNumber)
            continue;
        if (PARAMS_BLACKLIST_RHS.indexOf(toArg))
            continue;

        distribution[''] = 0.5;

        for (var fromArg of fromArgs) {
            var fromType = fromArgMap[fromArg];

            if (fromArgRequired[fromArg])
                continue;
            if (fromArg.startsWith('__'))
                continue;
            if (fromArg.endsWith('_id'))
                continue;
            if (PARAMS_BLACKLIST_LHS.indexOf(fromArg))
                continue;

            if (toArgRequired[toArg] || isAction) {
                if (String(fromType) === String(toType))
                    distribution[fromArg + '+is'] = 1;
            } else {
                if (toType.isArray && String(fromType) == String(toType.elem)) {
                    distribution[fromArg + '+has'] = 1;
                } else if (String(fromType) === String(toType)) {
                    var opdist = getOpDistribution(fromType);
                    var sum = 0;
                    for (var op in opdist)
                        sum += opdist[key];
                    for (var op in opdist)
                        distribution[fromArg + '+' + op] = opdist[key]/sum;
                }
            }
        }
        // only pass $event when for 'message' and 'status'
        if (toType.isString && (toArg === 'message' || toArg === 'status')) {
            distribution['$event+is'] = 0.1;
            //distribution['$event.title+is'] = 0.05;
        }
        var chosen = sample(distribution);
        if (!chosen)
            continue;
        chosen = chosen.split('+');
        to.args.push({ name: { id: 'tt:param.' + toArg }, operator: chosen[1], type: 'VarRef', value: { id: 'tt:param.' + chosen[0] } });
        //return;
    }
}

function queryIsUseful(query, queryMeta, action) {
    var argRequired = {};
    queryMeta.args.forEach(function(name, i) {
        argRequired[name] = queryMeta.required[i];
    });

    var anyFilter = false;
    query.args.forEach((arg) => {
        if (arg.operator !== 'is')
            anyFilter = true;
        if (!argRequired[arg.name.id.substr('tt:param.')])
            anyFilter = true;
    });
    if (anyFilter)
        return true;

    var anyComposition = false;
    action.args.forEach((arg) => {
        if (arg.type === 'VarRef')
            anyComposition = true;
    });
    if (anyComposition)
        return true;

    return false;
}

function connected(invocation) {
    if (!invocation)
        return false;
    return invocation.args.some((a) => a.type === 'VarRef');
}

function checkPicture(to, toMeta) {
    var hasPicture = false;

    for (var arg of toMeta.args) {
        if (arg === 'picture_url')
            hasPicture = true;
    }
    if (!hasPicture)
        return true;

    var setPicture = false;
    for (var arg of to.args) {
        if (arg.name.id === 'tt:param.picture_url') {
            setPicture = true;
        }
    }
    if (setPicture)
        return true;

    if (coin(0.1))
        return true;
    return false;
}

function genOneRandomRule(schemaRetriever, schemas, samplingPolicy) {
    return chooseRule(schemaRetriever, schemas, samplingPolicy).then(([triggerMeta, queryMeta, actionMeta]) => {
        var trigger = applyFilters(triggerMeta, false);
        var query = applyFilters(queryMeta, false);
        var action = applyFilters(actionMeta, true);

        if (query && action)
            applyComposition(query, queryMeta, action, actionMeta, true);
        if (trigger && query)
            applyComposition(trigger, triggerMeta, query, queryMeta, false);
        if (trigger && action && !query)
            applyComposition(trigger, triggerMeta, action, actionMeta, true);

        //if (trigger && trigger.args.length === 0)
        //    return genOneRandomRule(schemaRetriever, schemas, samplingPolicy);
        //if (action && action.args.length === 0)
        //    return genOneRandomRule(schemaRetriever, schemas, samplingPolicy);
        //if (query && query.args.length === 0)
        //    return genOneRandomRule(schemaRetriever, schemas, samplingPolicy);

        //if (query && action && !queryIsUseful(query, queryMeta, action)) // try again if not useful
        //    return genOneRandomRule(schemaRetriever, schemas, samplingPolicy);
        //if (trigger && action && !checkPicture(action, actionMeta))
        //    return genOneRandomRule(schemaRetriever, schemas, samplingPolicy);
        //if (query && action && !checkPicture(action, actionMeta))
        //    return genOneRandomRule(schemaRetriever, schemas, samplingPolicy);

        //if (!connected(query) && !connected(action))
        //    return genOneRandomRule(schemaRetriever, schemas, samplingPolicy);

        return { rule: { trigger: trigger, query: query, action: action }};
        //if (trigger)
        //    return { trigger: trigger };
        //if (action)
        //    return { action: action };
        //if (query)
        //    return { query: query };
    });
}

function genRandomRules(dbClient, schemaRetriever, samplingPolicy, language, N) {
    return getAllSchemas(dbClient).then((schemas) => {
        var i = 0;
        return new stream.Readable({
            objectMode: true,

            read: function() {
                if (i === N) {
                    this.push(null);
                    return;
                }
                i++;
                genOneRandomRule(schemaRetriever, schemas, samplingPolicy)
                    .done((rule) => this.push(rule), (e) => this.emit('error', e));
            }
        });
    });
}

module.exports = genRandomRules;