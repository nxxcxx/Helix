(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports = ['log', '$http', 'TMDB_API', 'EVT', '$cacheFactory', '$q', 'ENDPOINT_URI', function (log, $http, TMDB_API, EVT, $cacheFactory, $q, ENDPOINT_URI) {

	var searchResult = [];
	var prevResultLen = 0;
	var totalPages = -1;
	var currPage = 1;

	var movieIdCache = $cacheFactory('movieIdCache');
	// TMDB_API.url + 'movie/now_playing'

	var DB_ENDPOINT = ENDPOINT_URI + 'movie/';

	function putItemToDB(movieItem) {
		// todo dont put exisiting item in db ( UPSERT )
		$http.put(DB_ENDPOINT + movieItem.id, movieItem).then(function (res) {
			log.debug('api', 'PUT:', res);
		}, function (err) {
			log.debug('err', 'PUT:', err);
		});
	}

	function searchIdFromDB(id) {
		var promise = $http.get(DB_ENDPOINT + id).then(function (res) {
			log.debug('api', 'searchById => DB:', res.data);
			if (res.data) {
				movieIdCache.put(res.data.id, res.data);
				return res.data;
			} else {
				return null;
			}
		}, function (err) {
			log.debug('err', 'searchById => DB:', err);
		});
		return promise;
	}

	function searchIdFromAPI(id) {
		var promise = $http.get(TMDB_API.url + 'movie/' + id, {
			params: { api_key: TMDB_API.key }
		}).then(function (res) {
			log.debug('api', 'searchById => API:', res.data);
			movieIdCache.put(res.data.id, res.data);
			putItemToDB(res.data);
			return res.data;
		}, function (err) {
			log.debug('err', 'searchById => API:', err);
		});
		return promise;
	}

	function searchById(id) {

		var df_DB = $q.defer();
		var df_Res = $q.defer();

		var cachedItem = movieIdCache.get(id);
		if (cachedItem) {
			log.debug('api', 'searchById => cache:', cachedItem);
			df_Res.resolve(cachedItem);
			return df_Res.promise;
		}

		searchIdFromDB(id).then(function (res) {
			if (res) {
				df_DB.resolve(res);
			} else {
				df_DB.reject('not found');
			}
		}, function (err) {
			df_DB.reject(err);
		});

		df_DB.promise.then(function (res_DB) {
			df_Res.resolve(res_DB);
		}, function (err) {
			searchIdFromAPI(id).then(function (res_api) {
				df_Res.resolve(res_api);
			}, function (err_api) {
				df_Res.reject(err_api);
			});
		});

		return df_Res.promise;
	}

	function searchByTitle(searchObj) {

		if (currPage > totalPages && totalPages !== -1) {
			// emit event end of page
			EVT.EOP.emit();
			return;
		}

		$http.get(TMDB_API.url + 'search/movie', {
			cache: true,
			params: {
				api_key: TMDB_API.key,
				query: searchObj.query,
				page: currPage
			}
		}).then(function (res) {
			// emit event search success
			searchResult = searchResult.concat(removeNoPosterItems(res.data.results));
			totalPages = res.data.total_pages;
			currPage++;
			prevResultLen = searchResult.length;
			log.debug('api', 'searchByTitle:', res, res.data);

			// cache
			res.data.results.forEach(function (item) {

				if (!movieIdCache.get(item.id)) {
					log.debug('api', item.id, item);
					movieIdCache.put(item.id, item);
				}
			});
		}, function (err) {
			// emit event search err
			log.debug('err', 'searchByTitle:', err);
		});
	}

	function removeNoPosterItems(results) {
		return results.filter(function (item) {
			return !!item.poster_path;
		});
	}

	function getRes() {
		return searchResult;
	}

	function clearSearch() {
		// emit event clearSeach
		searchResult.length = 0;
		prevResultLen = 0;
		totalPages = -1;
		currPage = 1;
	}

	return {
		searchByTitle: searchByTitle,
		searchById: searchById,
		clearSearch: clearSearch,
		getRes: getRes,
		prevResultLen: prevResultLen,
		putItemToDB: putItemToDB,
		movieIdCache: movieIdCache
	};
}];

},{}],2:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', 'authToken', function (log, ENDPOINT_URI, $http, $q, authToken) {

	var identity = null;
	var _identityResolved = false;

	function authorize(force) {

		var deferred = $q.defer();

		if (force) identity = null;

		if (identity !== null) {

			deferred.resolve(true);
		} else {

			$http.get(ENDPOINT_URI + 'auth', { requireAuth: true }).then(function (res) {

				log.debug('auth', 'auth.authorize():', res, res.data);
				identity = res.data;
				_identityResolved = true;
				deferred.resolve(true);
			}, function (err) {

				log.debug('err', 'authorize', err, err.data);
				// todo if jwt expired , deauthorize, remove local storage, redirect
				_identityResolved = true;
				deferred.reject(err);
			});
		}

		return deferred.promise;
	}

	function deauthorize() {
		authToken.removeToken();
		identity = null;
	}

	function isAuthenticated() {
		return identity !== null;
	}

	function identityResolved() {
		return _identityResolved;
	}

	return {

		authorize: authorize,
		deauthorize: deauthorize,
		isAuthenticated: isAuthenticated,
		identityResolved: identityResolved

	};
}];

},{}],3:[function(require,module,exports){
'use strict';

module.exports = ['authToken', function (authToken) {

	function request(config) {

		if (config.requireAuth) {
			var token = authToken.getToken();
			if (token) {
				// http://self-issued.info/docs/draft-ietf-oauth-v2-bearer.html   section 2.1
				// https://developers.google.com/gmail/markup/actions/verifying-bearer-tokens
				// http://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html section 4.2 header field name case insensitive
				config.headers.Authorization = 'Bearer ' + token;
			}
		}

		return config;
	}

	function response(res) {
		return res;
	}

	return {

		request: request,
		response: response

	};
}];

},{}],4:[function(require,module,exports){
'use strict';

module.exports = ['log', '$window', function (log, $window) {

	var storage = $window.localStorage;
	var cachedToken = null;

	function setToken(token) {
		cachedToken = token;
		storage.setItem('jwt', token);
	}

	function getToken() {
		if (!cachedToken) {
			cachedToken = storage.getItem('jwt');
		}
		return cachedToken;
	}

	function removeToken() {
		cachedToken = null;
		storage.removeItem('jwt');
		log.debug('auth', 'token removed');
	}

	function hasToken() {
		return !!getToken();
	}

	return {

		setToken: setToken,
		getToken: getToken,
		removeToken: removeToken,
		hasToken: hasToken

	};
}];

},{}],5:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {
		email: '',
		password: ''
	};

	vm.signin = function () {

		if (vm.user.email === '' || vm.user.password === '') {
			log.debug('auth', 'email & password required.');
			return;
		}

		$http.post(ENDPOINT_URI + 'signin', vm.user).then(function (res) {
			log.debug('auth', 'signin', res, res.data);
			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err, status) {
			log.debug('err', 'signin', err);
		});
	};
}];

},{}],6:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'auth', 'movieCollection', function ($state, auth, movieCollection) {

	auth.deauthorize();
	movieCollection._clear();
	$state.go('signin');
}];

},{}],7:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {};

	vm.signup = function () {

		if (vm.user.email === undefined || vm.user.password === undefined) {
			log.debug('warn', 'email & password required.');
			return;
		}

		log.debug('auth', 'signing up...');
		$http.post(ENDPOINT_URI + 'signup', vm.user).then(function (res) {

			log.debug('auth', 'Registered.', res);

			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err) {

			log.debug('err', err);
			vm.form.$submitted = false;
		});
	};
}];

},{}],8:[function(require,module,exports){
'use strict';

module.exports = ['$rootScope', function ($rootScope) {

	var EVT = {

		EOP: {
			listen: function listen(cb) {
				$rootScope.$on('EOP', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('EOP');
			}
		},
		collectionModalOpen: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalOpen', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalOpen');
			}
		},
		collectionModalClose: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalClose', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalClose');
			}
		}

	};

	return EVT;
}];

},{}],9:[function(require,module,exports){
'use strict';

module.exports = [function () {

	var debugEnabled = false;
	var debugNamespaces = [];

	this.enableDebug = function () {
		debugEnabled = true;
	};

	this.enableDebugNamespace = function () {
		for (var i = 0; i < arguments.length; i++) {
			debugNamespaces.push(arguments[i]);
		}
	};

	this.$get = function () {

		function debug() {
			if (!debugEnabled) return;
			var debugName = arguments[0];
			var slicedArgs = Array.prototype.slice.call(arguments, 1);
			if (debugName === 'err') {
				console.error.apply(console, slicedArgs);
			} else if (debugName === 'info') {
				console.info.apply(console, slicedArgs);
			} else if (debugName === 'warn') {
				console.warn.apply(console, slicedArgs);
			} else if (debugNamespaces.indexOf(debugName) !== -1) {
				console.log.apply(console, [debugName].concat(slicedArgs));
			}
		}

		return {
			debug: debug
		};
	};
}];

},{}],10:[function(require,module,exports){
"use strict";

module.exports = [function () {

	function debounce(func, wait, immediate) {
		var _this = this,
		    _arguments = arguments;

		var timeout;
		return function () {

			var context = _this,
			    args = _arguments;
			var later = function later() {

				timeout = null;
				if (!immediate) func.apply(context, args);
			};
			var callNow = immediate && !timeout;
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
			if (callNow) func.apply(context, args);
		};
	}

	return {
		debounce: debounce
	};
}];

},{}],11:[function(require,module,exports){
'use strict';

module.exports = ['$httpProvider', function ($httpProvider) {
	$httpProvider.interceptors.push('authInterceptor');
}];

},{}],12:[function(require,module,exports){
'use strict';

module.exports = ['logProvider', '$httpProvider', function (logProvider, $httpProvider) {

	logProvider.enableDebug();
	// logProvider.enableDebugNamespace( 'info', 'err', 'auth', 'api', 'collection' );
	logProvider.enableDebugNamespace('info', 'err');

	$httpProvider.useLegacyPromiseExtensions(false);
}];

},{}],13:[function(require,module,exports){
'use strict';

module.exports = ['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

	$urlRouterProvider.otherwise('/');

	$stateProvider.state('helix', {
		url: '/',
		templateUrl: './template/helix.html'
	}).state('signup', {
		url: '/signup',
		templateUrl: './template/signup.html',
		controller: 'signupCtrl',
		controllerAs: 'signup'
	}).state('signin', {
		url: '/signin',
		templateUrl: './template/signin.html',
		controller: 'signinCtrl',
		controllerAs: 'signin'
	}).state('signout', {
		url: '/signout',
		controller: 'signoutCtrl'
	}).state('movieDetail', {
		url: '/movie/:movieId',
		templateUrl: './template/movieDetail.html',
		controller: 'movieDetailCtrl',
		controllerAs: 'md',
		resolve: {
			movieItem: ['$stateParams', 'TMDb', function ($stateParams, TMDb) {
				return TMDb.searchById($stateParams.movieId);
			}]
		}
	}).state('collection', {
		url: '/collection',
		templateUrl: './template/collection.html',
		controller: 'movieCollectionCtrl',
		controllerAs: 'mc',
		resolve: {
			authorize: ['auth', function (auth) {
				return auth.authorize();
			}],
			resolvedCollection: ['movieCollection', function (movieCollection) {
				return movieCollection.resolveCollection();
			}]
		}
	});
}];

},{}],14:[function(require,module,exports){
'use strict';

module.exports = ['$window', 'ENGINE', 'util', function ($window, ENGINE, util) {

	function ctrl($scope, $element) {

		ENGINE.attachRenderer($element);
		$($window).on('resize', util.debounce(ENGINE.onWindowResize, 100));
		$element.on('wheel', function (evt) {
			ENGINE.$$.wheel_dy = -Math.sign(evt.originalEvent.deltaY);
		});

		ENGINE.start();
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div id="canvas-container"></div>'
	};
}];

},{}],15:[function(require,module,exports){
'use strict';

module.exports = ['$window', function ($window) {

	var $$ = {
		canvas: null,
		stats: new Stats(),
		scene: new THREE.Scene(),
		width: $(window).width(),
		height: $(window).height(),
		camera: new THREE.PerspectiveCamera(70, this.width / this.height, 10, 100000),
		renderer: new THREE.CSS3DRenderer(),
		screen_ratio: this.width / this.height,
		pixel_ratio: $window.devicePixelRatio || 1,
		mouse_x: this.width * 0.5,
		mouse_y: this.height * 0.5,
		wheel_dy: 0
	};

	$$.renderer.setSize($$.width, $$.height);

	function attachRenderer(canvas) {
		$$.canvas = canvas;
		canvas.append($$.renderer.domElement);
		canvas.append($$.stats.domElement);
	}

	function onWindowResize() {
		$$.width = $(window).width();
		$$.height = $(window).height();
		$$.pixel_ratio = $window.devicePixelRatio || 1;
		$$.screen_ratio = $$.width / $$.height;
		$$.camera.aspect = $$.screen_ratio;
		$$.camera.updateProjectionMatrix();
		$$.renderer.setSize($$.width, $$.height);
	}

	function setup() {}

	function update() {

		if (Math.abs($$.wheel_dy) > 0.001) {
			$$.camera.position.y += $$.wheel_dy * 1.0;
			$$.camera.rotateY($$.wheel_dy * 0.025);
			$$.wheel_dy *= 0.95;
		}
	}

	// ----  draw loop
	function run() {

		requestAnimationFrame(run);
		update();
		$$.renderer.render($$.scene, $$.camera);
		$$.stats.update();
	}

	function start() {
		setup();
		run();
	}

	function resetCamera() {
		$$.camera.position.set(0, 0, 0);
		$$.camera.rotation.set(0, 0, 0);
	}

	return {
		$$: $$,
		attachRenderer: attachRenderer,
		onWindowResize: onWindowResize,
		start: start,
		resetCamera: resetCamera
	};
}];

},{}],16:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENGINE', '$compile', '$rootScope', function (log, ENGINE, $compile, $rootScope) {

	var allPosters = new THREE.Object3D();
	ENGINE.$$.scene.add(allPosters);

	function makeHelixPosters(posterObjectMulti, offsetStartIdx) {

		var vector = new THREE.Vector3();
		var radius = 900;
		for (var i = 0; i < posterObjectMulti.length; i++) {

			var $isolatedScope = $rootScope.$new(true);
			$isolatedScope.movieItem = posterObjectMulti[i];

			var posterDirectiveElem = $compile('<poster></poster>')($isolatedScope)[0];
			var css3dObj = new THREE.CSS3DObject(posterDirectiveElem);

			// tag alog an isolatedScope to be destroy when dispose an element
			css3dObj.scope = $isolatedScope;

			var hidx = i + offsetStartIdx;
			var phi = hidx * 0.175 + Math.PI;
			css3dObj.position.x = -radius * Math.sin(phi);
			css3dObj.position.y = -(hidx * 8) + 200;
			css3dObj.position.z = radius * Math.cos(phi);

			vector.set(-css3dObj.position.x * 2, css3dObj.position.y, -css3dObj.position.z * 2);

			css3dObj.lookAt(vector);
			allPosters.add(css3dObj);
		}

		log.debug('info', 'curr posters:', allPosters.children.length);
	}

	function clearAll() {
		allPosters.children.forEach(function (poster) {
			poster.disposeElement();
			poster.scope.$destroy();
		});
		allPosters.children.length = 0; // clear items
	}

	return {
		makeHelixPosters: makeHelixPosters,
		clearAll: clearAll
	};
}];

},{}],17:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'collectionModalService', function ($state, collectionModalService) {

	function ctrl($scope, $element) {

		// $scope.movieItem obj is passed thru isolatedScope via compiled directive in helix.fac.js
		var img = new Image();
		var imgUrl = 'http://image.tmdb.org/t/p/w154/' + $scope.movieItem.poster_path;
		img.onload = function () {

			// todo move css into sass, use class instead
			$element.css({
				'width': '150px',
				'height': '230px',
				'background-repeat': 'no-repeat',
				'background-size': '150px 230px',
				'background-image': 'url(' + imgUrl + ')',
				'display': 'none' // required for fadeIn animation
			});
			$element.fadeIn(1500);
		};
		img.src = imgUrl;

		$element.on('click', function (evt) {
			$state.go('movieDetail', { movieId: $scope.movieItem.id });
			collectionModalService.setActiveItem($scope.movieItem);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div class="posterElem"></div>'
	};
}];

},{}],18:[function(require,module,exports){
'use strict';

angular.module('app', ['ui.router', 'ngAnimate']).constant('ENDPOINT_URI', 'http://localhost:8001/').constant('TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
}).provider('log', require('./common/log.pv.js')).factory('util', require('./common/util.js')).factory('EVT', require('./common/events.fac.js')).factory('TMDb', require('./API/TMDb.fac.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('display', require('./helix/display.dir.js')).directive('poster', require('./helix/poster.dir.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).controller('movieCollectionCtrl', require('./movieCollection/movieCollection.ctrl.js')).factory('movieCollection', require('./movieCollection/movieCollection.fac.js')).factory('collectionModalService', require('./movieCollection/collectionModalService.fac.js')).directive('collectionModal', require('./movieCollection/collectionModal.dir.js')).directive('collectionItem', require('./movieCollection/collectionItem.dir.js')).config(require('./config/routeConfig.js')).config(require('./config/logConfig.js')).config(require('./config/httpConfig.js')).run(['log', '$rootScope', '$state', 'auth', 'movieCollection', function (log, $rootScope, $state, auth, movieCollection) {

	auth.authorize(true);

	movieCollection.resolveCollection();

	$rootScope.$on('$stateChangeError', function (event, toState, toParams, fromState, fromParams, error) {

		event.preventDefault(); // prevent transition
		log.debug('warn', error);
		if (error) {
			$state.go('signin');
		}
	});
}]);

},{"./API/TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/signin.ctrl.js":5,"./auth/signout.ctrl.js":6,"./auth/signup.ctrl.js":7,"./common/events.fac.js":8,"./common/log.pv.js":9,"./common/util.js":10,"./config/httpConfig.js":11,"./config/logConfig.js":12,"./config/routeConfig.js":13,"./helix/display.dir.js":14,"./helix/engine.fac.js":15,"./helix/helix.fac.js":16,"./helix/poster.dir.js":17,"./main.ctrl.js":19,"./movieCollection/collectionItem.dir.js":20,"./movieCollection/collectionModal.dir.js":21,"./movieCollection/collectionModalService.fac.js":22,"./movieCollection/movieCollection.ctrl.js":23,"./movieCollection/movieCollection.fac.js":24,"./movieDetail.ctrl.js":25}],19:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', 'auth', '$state', function (log, $scope, TMDb, EVT, helix, ENGINE, auth, $state) {

	var vm = this;
	vm.auth = auth;
	vm.search = {
		query: ''
	};
	vm.movieItems = null;

	$scope.$watch(TMDb.getRes, function (movItems) {

		vm.movieItems = movItems;
		helix.makeHelixPosters(movItems.slice(TMDb.prevResultLen), TMDb.prevResultLen);
	}, true);

	var prevQuery = '';
	vm.search = function () {
		if (vm.search.query === '') return;
		if (prevQuery !== vm.search.query) {
			prevQuery = vm.search.query;
			TMDb.clearSearch();
			helix.clearAll();
			ENGINE.resetCamera();
		}
		if ($state.current.name !== 'helix') {
			$state.go('helix');
		}
		TMDb.searchByTitle(vm.search);
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;
	vm.STATE = $state;

	EVT.EOP.listen(function () {
		log.debug('info', 'recieved EOP event!');
	});
}];

},{}],20:[function(require,module,exports){
'use strict';

module.exports = ['log', 'TMDb', function (log, TMDb) {

	function ctrl($scope, $attrs, $element) {

		TMDb.searchById(parseInt($scope.movieId)).then(function (res) {

			// log.debug( 'info', 'collectionItemDirective', res );
			var imgUrl = 'http://image.tmdb.org/t/p/w92/' + res.poster_path;
			$element.css({
				'width': '100%',
				'height': '100%',
				'background-repeat': 'no-repeat',
				'background-size': '100% 100%',
				'background-image': 'url(' + imgUrl + ')'
			});
		}, function (err) {
			log.debug('err', 'collectionItemDirective', err);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		scope: { movieId: '@' },
		controller: ctrl,
		controllerAs: 'ci',
		template: '<div></div>'
	};
}];

},{}],21:[function(require,module,exports){
'use strict';

module.exports = ['log', 'movieCollection', 'collectionModalService', 'EVT', function (log, movieCollection, collectionModalService, EVT) {

	function ctrl($scope, $element, $attrs) {

		var vm = this;
		vm.movieCollection = movieCollection;
		vm.collectionModalService = collectionModalService;

		vm.addingNewCollection = false;

		vm.openEditor = function () {
			vm.addingNewCollection = true;
		};

		vm.closeEditor = function () {
			vm.addingNewCollection = false;
		};

		vm.createNewCollection = function () {
			movieCollection.create($scope.newCollectionName);
			vm.closeEditor();
		};

		vm.addToCollection = function (movieId, collectionName) {
			log.debug('collection', 'addToCollection:', movieId, collectionName);
			var success = movieCollection.push(movieId, collectionName);
			log.debug('collection', 'movieCollection.push', success);
		};

		// default css at directive initialization
		$element.css({ visibility: 'hidden' });

		EVT.collectionModalOpen.listen(function () {
			log.debug('collection', 'collectionModalOpen');
			$element.css({ visibility: 'visible' });
		});

		EVT.collectionModalClose.listen(function () {
			log.debug('collection', 'collectionModalClose');
			$element.css({ visibility: 'hidden' });
		});
	}

	return {

		restrict: 'E',
		scope: {},
		controller: ctrl,
		controllerAs: 'modal',
		replace: true,
		templateUrl: './template/collectionModal.html'

	};
}];

},{}],22:[function(require,module,exports){
'use strict';

module.exports = ['log', 'EVT', function (log, EVT) {

	var activeItem = null;

	function setActiveItem(item) {
		activeItem = item;
	}

	function getActiveItem(item) {
		return activeItem;
	}

	function open() {
		EVT.collectionModalOpen.emit();
	}

	function close() {
		EVT.collectionModalClose.emit();
	}

	return {
		setActiveItem: setActiveItem,
		getActiveItem: getActiveItem,
		open: open,
		close: close
	};
}];

},{}],23:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'auth', 'movieCollection', function (log, $scope, auth, movieCollection) {

	log.debug('collection', 'collectionCtrl', movieCollection.getCollection());
	var vm = this;
	vm.movieCollection = movieCollection;

	vm.viewCollection = function (collection) {
		console.log(collection);
		/* call movieCollection.fetchAll()
  	clearHelix()
  	call make helix w/ fetched result
  	ui state -> helix
  */
	};
}];

},{}],24:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', function (log, ENDPOINT_URI, $http, $q) {

	var DB_ENDPOINT = ENDPOINT_URI + 'collection';
	var collection = null;

	var fullCollection = null;

	function create(name) {
		collection.push({ collectionName: name, movies: [] });
		put();
	}

	function isEmpty() {
		return collection.length === 0;
	}

	function fetchAll(collectionName) {}

	function resolveCollection() {

		var deferred = $q.defer();

		if (collection !== null) {
			deferred.resolve(collection);
		} else {
			$http.get(DB_ENDPOINT, { requireAuth: true }).then(function (res) {
				log.debug('collection', 'collection.resolveCollection():', res);
				if (res.data) {
					collection = res.data;
				} else {
					collection = [];
				}
				deferred.resolve(true);
			}, function (err) {
				log.debug('err', 'collection.resolveCollection():', err);
				deferred.reject(err);
			});
		}

		return deferred.promise;
	}

	function hasItem(itemId, someCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === someCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						return true;
					}
				}
			}
		}
		return false;
	}

	function put() {
		$http.put(DB_ENDPOINT, collection, { requireAuth: true }).then(function (res) {
			log.debug('collection', 'collection.put():', res);
		}, function (err) {
			log.debug('err', 'collection.put():', err);
		});
	}

	function push(itemId, toCollection) {
		if (hasItem(itemId, toCollection)) {
			return false;
		}
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === toCollection) {
				collection[i].movies.push(itemId);
				put();
				return true;
			}
		}
		return false;
	}

	function remove(itemId, inCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === inCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						var removed = collection[i].movies.splice(k, 1).length;
						put();
						return removed !== 0;
					}
				}
			}
		}
		return false;
	}

	function removeCollection(collectionName) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === collectionName) {
				var removed = collection.splice(i, 1).length;
				put();
				return removed !== 0;
			}
		}
		return false;
	}

	function sync() {
		// sync local colelction w/ DB
	}

	function getCollection() {
		return collection;
	}

	function _clear() {
		collection = null;
		log.debug('collection', 'local collection cleared.');
	}

	return {
		getCollection: getCollection,
		create: create,
		push: push,
		put: put,
		remove: remove,
		removeCollection: removeCollection,
		sync: sync,
		_clear: _clear,
		resolveCollection: resolveCollection,
		hasItem: hasItem,
		isEmpty: isEmpty
	};
}];

},{}],25:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', '$cacheFactory', 'movieItem', 'collectionModalService', 'movieCollection', function (log, $scope, TMDb, $cacheFactory, movieItem, collectionModalService, movieCollection) {

	var vm = this;
	vm.movieItem = movieItem; // movieItem injected via state resolve
	log.debug('ctrl', 'movieDetail ctrl resolved:', vm.movieItem);

	movieItem.fullTitle = movieItem.title;
	if (movieItem.title !== movieItem.original_title) {
		movieItem.fullTitle = movieItem.title + ' (' + movieItem.original_title + ')';
	}

	if (movieItem.backdrop_path) {
		var imgUrl = 'http://image.tmdb.org/t/p/original' + movieItem.backdrop_path;
		$('.backdrop').css({
			'background-image': 'url(' + imgUrl + ')'
		});
	}

	vm.openCollectionModal = function () {
		collectionModalService.setActiveItem(movieItem);
		collectionModalService.open();
	};
}];

},{}]},{},[18])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvVXNlcnMvbngvZGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL0FQSS9UTURiLmZhYy5qcyIsIi9Vc2Vycy9ueC9kZXYvd2ViL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9hdXRoLmZhYy5qcyIsIi9Vc2Vycy9ueC9kZXYvd2ViL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzIiwiL1VzZXJzL254L2Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhUb2tlbi5mYWMuanMiLCIvVXNlcnMvbngvZGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbmluLmN0cmwuanMiLCIvVXNlcnMvbngvZGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbm91dC5jdHJsLmpzIiwiL1VzZXJzL254L2Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL3NpZ251cC5jdHJsLmpzIiwiL1VzZXJzL254L2Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9jb21tb24vZXZlbnRzLmZhYy5qcyIsIi9Vc2Vycy9ueC9kZXYvd2ViL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvY29tbW9uL2xvZy5wdi5qcyIsIi9Vc2Vycy9ueC9kZXYvd2ViL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvY29tbW9uL3V0aWwuanMiLCIvVXNlcnMvbngvZGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2NvbmZpZy9odHRwQ29uZmlnLmpzIiwiL1VzZXJzL254L2Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9jb25maWcvbG9nQ29uZmlnLmpzIiwiL1VzZXJzL254L2Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9jb25maWcvcm91dGVDb25maWcuanMiLCIvVXNlcnMvbngvZGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2hlbGl4L2Rpc3BsYXkuZGlyLmpzIiwiL1VzZXJzL254L2Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9lbmdpbmUuZmFjLmpzIiwiL1VzZXJzL254L2Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9oZWxpeC5mYWMuanMiLCIvVXNlcnMvbngvZGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2hlbGl4L3Bvc3Rlci5kaXIuanMiLCIvVXNlcnMvbngvZGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2luZGV4LmpzIiwiL1VzZXJzL254L2Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9tYWluLmN0cmwuanMiLCIvVXNlcnMvbngvZGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uSXRlbS5kaXIuanMiLCIvVXNlcnMvbngvZGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWwuZGlyLmpzIiwiL1VzZXJzL254L2Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsU2VydmljZS5mYWMuanMiLCIvVXNlcnMvbngvZGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL21vdmllQ29sbGVjdGlvbi9tb3ZpZUNvbGxlY3Rpb24uY3RybC5qcyIsIi9Vc2Vycy9ueC9kZXYvd2ViL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5mYWMuanMiLCIvVXNlcnMvbngvZGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL21vdmllRGV0YWlsLmN0cmwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxjQUFjLEVBQzNGLFVBQVcsR0FBRyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFHOztBQUV2RSxLQUFJLFlBQVksR0FBRyxFQUFFLENBQUM7QUFDdEIsS0FBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDO0FBQ3RCLEtBQUksVUFBVSxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ3BCLEtBQUksUUFBUSxHQUFHLENBQUMsQ0FBQzs7QUFFakIsS0FBSSxZQUFZLEdBQUcsYUFBYSxDQUFFLGNBQWMsQ0FBRSxDQUFDOzs7QUFHbkQsS0FBSSxXQUFXLEdBQUcsWUFBWSxHQUFHLFFBQVEsQ0FBQzs7QUFFMUMsVUFBUyxXQUFXLENBQUUsU0FBUyxFQUFHOztBQUVqQyxPQUFLLENBQUMsR0FBRyxDQUFFLFdBQVcsR0FBRyxTQUFTLENBQUMsRUFBRSxFQUFFLFNBQVMsQ0FBRSxDQUNqRCxJQUFJLENBQUUsVUFBVyxHQUFHLEVBQUc7QUFDdkIsTUFBRyxDQUFDLEtBQUssQ0FBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsQ0FBRSxDQUFDO0dBQ2hDLEVBQUUsVUFBVyxHQUFHLEVBQUc7QUFDbkIsTUFBRyxDQUFDLEtBQUssQ0FBRSxLQUFLLEVBQUUsTUFBTSxFQUFFLEdBQUcsQ0FBRSxDQUFDO0dBQ2hDLENBQUUsQ0FBQztFQUNKOztBQUVELFVBQVMsY0FBYyxDQUFFLEVBQUUsRUFBRztBQUM3QixNQUFJLE9BQU8sR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFFLFdBQVcs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ckIscUJBQWtCLEVBQUUsTUFBTSxHQUFHLE1BQU0sR0FBRyxHQUFHO0dBQ3pDLENBQUUsQ0FBQztFQUNKOztBQUVELEdBQUUsQ0FBQyxtQkFBbUIsR0FBRyxZQUFZO0FBQ3BDLHdCQUFzQixDQUFDLGFBQWEsQ0FBRSxTQUFTLENBQUUsQ0FBQztBQUNsRCx3QkFBc0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQztFQUM5QixDQUFDO0NBRUYsQ0FBRSxDQUFDIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRodHRwJywgJ1RNREJfQVBJJywgJ0VWVCcsICckY2FjaGVGYWN0b3J5JywgJyRxJywgJ0VORFBPSU5UX1VSSScsXG5mdW5jdGlvbiAoIGxvZywgJGh0dHAsIFRNREJfQVBJLCBFVlQsICRjYWNoZUZhY3RvcnksICRxLCBFTkRQT0lOVF9VUkkgKSB7XG5cblx0dmFyIHNlYXJjaFJlc3VsdCA9IFtdO1xuXHR2YXIgcHJldlJlc3VsdExlbiA9IDA7XG5cdHZhciB0b3RhbFBhZ2VzID0gLTE7XG5cdHZhciBjdXJyUGFnZSA9IDE7XG5cblx0dmFyIG1vdmllSWRDYWNoZSA9ICRjYWNoZUZhY3RvcnkoICdtb3ZpZUlkQ2FjaGUnICk7XG5cdC8vIFRNREJfQVBJLnVybCArICdtb3ZpZS9ub3dfcGxheWluZydcblxuXHR2YXIgREJfRU5EUE9JTlQgPSBFTkRQT0lOVF9VUkkgKyAnbW92aWUvJztcblxuXHRmdW5jdGlvbiBwdXRJdGVtVG9EQiggbW92aWVJdGVtICkge1xuXHRcdC8vIHRvZG8gZG9udCBwdXQgZXhpc2l0aW5nIGl0ZW0gaW4gZGIgKCBVUFNFUlQgKVxuXHRcdCRodHRwLnB1dCggREJfRU5EUE9JTlQgKyBtb3ZpZUl0ZW0uaWQsIG1vdmllSXRlbSApXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgJ1BVVDonLCByZXMgKTtcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdQVVQ6JywgZXJyICk7XG5cdFx0fSApO1xuXHR9XG5cblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tREIoIGlkICkge1xuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCArIGlkIClcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBEQjonLCByZXMuZGF0YSApO1xuXHRcdFx0aWYgKCByZXMuZGF0YSApIHtcblx0XHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XG5cdFx0XHRcdHJldHVybiByZXMuZGF0YTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdHJldHVybiBudWxsO1xuXHRcdFx0fVxuXHRcdH0sIGZ1bmN0aW9uKCBlcnIgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBEQjonLCBlcnIgKTtcblx0XHR9ICk7XG5cdFx0cmV0dXJuIHByb21pc2U7XG5cdH1cblxuXHRmdW5jdGlvbiBzZWFyY2hJZEZyb21BUEkoIGlkICkge1xuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBUTURCX0FQSS51cmwgKyAnbW92aWUvJyArIGlkLCB7XG5cdFx0XHRwYXJhbXM6IHsgYXBpX2tleTogVE1EQl9BUEkua2V5IH1cblx0XHR9ICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgcmVzLmRhdGEgKTtcblx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIHJlcy5kYXRhLmlkLCByZXMuZGF0YSApO1xuXHRcdFx0cHV0SXRlbVRvREIoIHJlcy5kYXRhICk7XG5cdFx0XHRyZXR1cm4gcmVzLmRhdGE7XG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgZXJyICk7XG5cdFx0fSApO1xuXHRcdHJldHVybiBwcm9taXNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gc2VhcmNoQnlJZCggaWQgKSB7XG5cblx0XHR2YXIgZGZfREIgPSAkcS5kZWZlcigpO1xuXHRcdHZhciBkZl9SZXMgPSAkcS5kZWZlcigpO1xuXG5cdFx0dmFyIGNhY2hlZEl0ZW0gPSBtb3ZpZUlkQ2FjaGUuZ2V0KCBpZCApO1xuXHRcdGlmICggY2FjaGVkSXRlbSApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsICdzZWFyY2hCeUlkID0+IGNhY2hlOicsIGNhY2hlZEl0ZW0gKTtcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCBjYWNoZWRJdGVtICk7XG5cdFx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XG5cdFx0fVxuXG5cdFx0c2VhcmNoSWRGcm9tREIoIGlkICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRpZiAoIHJlcyApIHtcblx0XHRcdFx0ZGZfREIucmVzb2x2ZSggcmVzICk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRkZl9EQi5yZWplY3QoICdub3QgZm91bmQnICk7XG5cdFx0XHR9XG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRcdGRmX0RCLnJlamVjdCggZXJyICk7XG5cdFx0fSApO1xuXG5cdFx0ZGZfREIucHJvbWlzZS50aGVuKCBmdW5jdGlvbiAoIHJlc19EQiApIHtcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfREIgKTtcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdHNlYXJjaElkRnJvbUFQSSggaWQgKS50aGVuKCBmdW5jdGlvbiAoIHJlc19hcGkgKSB7XG5cdFx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfYXBpICk7XG5cdFx0XHR9LCBmdW5jdGlvbiAoIGVycl9hcGkgKSB7XG5cdFx0XHRcdGRmX1Jlcy5yZWplY3QoIGVycl9hcGkgKTtcblx0XHRcdH0gKTtcblx0XHR9ICk7XG5cblx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHNlYXJjaEJ5VGl0bGUoIHNlYXJjaE9iaiApIHtcblxuXHRcdGlmICggY3VyclBhZ2UgPiB0b3RhbFBhZ2VzICYmIHRvdGFsUGFnZXMgIT09IC0xICkge1xuXHRcdFx0Ly8gZW1pdCBldmVudCBlbmQgb2YgcGFnZVxuXHRcdFx0RVZULkVPUC5lbWl0KCk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0JGh0dHAuZ2V0KCBUTURCX0FQSS51cmwgKyAnc2VhcmNoL21vdmllJywge1xuXHRcdFx0Y2FjaGU6IHRydWUsXG5cdFx0XHRwYXJhbXM6IHtcblx0XHRcdFx0YXBpX2tleTogVE1EQl9BUEkua2V5LFxuXHRcdFx0XHRxdWVyeTogc2VhcmNoT2JqLnF1ZXJ5LFxuXHRcdFx0XHRwYWdlOiBjdXJyUGFnZVxuXHRcdFx0fVxuXHRcdH0gKVxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblx0XHRcdC8vIGVtaXQgZXZlbnQgc2VhcmNoIHN1Y2Nlc3Ncblx0XHRcdHNlYXJjaFJlc3VsdCA9IHNlYXJjaFJlc3VsdC5jb25jYXQoIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlcy5kYXRhLnJlc3VsdHMgKSApO1xuXHRcdFx0dG90YWxQYWdlcyA9IHJlcy5kYXRhLnRvdGFsX3BhZ2VzO1xuXHRcdFx0Y3VyclBhZ2UgKys7XG5cdFx0XHRwcmV2UmVzdWx0TGVuID0gc2VhcmNoUmVzdWx0Lmxlbmd0aDtcblx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsICdzZWFyY2hCeVRpdGxlOicsIHJlcywgcmVzLmRhdGEgKTtcblxuXHRcdFx0Ly8gY2FjaGVcblx0XHRcdHJlcy5kYXRhLnJlc3VsdHMuZm9yRWFjaCggZnVuY3Rpb24gKCBpdGVtICkge1xuXG5cdFx0XHRcdGlmICggIW1vdmllSWRDYWNoZS5nZXQoIGl0ZW0uaWQgKSApIHtcblx0XHRcdFx0XHRsb2cuZGVidWcoICdhcGknLCBpdGVtLmlkLCBpdGVtICk7XG5cdFx0XHRcdFx0bW92aWVJZENhY2hlLnB1dCggaXRlbS5pZCwgaXRlbSApO1xuXHRcdFx0XHR9XG5cblx0XHRcdH0gKTtcblxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0Ly8gZW1pdCBldmVudCBzZWFyY2ggZXJyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlUaXRsZTonLCBlcnIgKTtcblx0XHR9ICk7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlc3VsdHMgKSB7XG5cdFx0cmV0dXJuIHJlc3VsdHMuZmlsdGVyKCBmdW5jdGlvbiAoIGl0ZW0gKSB7XG5cdFx0XHRyZXR1cm4gISFpdGVtLnBvc3Rlcl9wYXRoO1xuXHRcdH0gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdldFJlcygpIHtcblx0XHRyZXR1cm4gc2VhcmNoUmVzdWx0O1xuXHR9XG5cblx0ZnVuY3Rpb24gY2xlYXJTZWFyY2goKSB7XG5cdFx0Ly8gZW1pdCBldmVudCBjbGVhclNlYWNoXG5cdFx0c2VhcmNoUmVzdWx0Lmxlbmd0aCA9IDA7XG5cdFx0cHJldlJlc3VsdExlbiA9IDA7XG5cdFx0dG90YWxQYWdlcyA9IC0xO1xuXHRcdGN1cnJQYWdlID0gMTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0c2VhcmNoQnlUaXRsZSxcblx0XHRzZWFyY2hCeUlkLFxuXHRcdGNsZWFyU2VhcmNoLFxuXHRcdGdldFJlcyxcblx0XHRwcmV2UmVzdWx0TGVuLFxuXHRcdHB1dEl0ZW1Ub0RCLFxuXHRcdG1vdmllSWRDYWNoZVxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkRQT0lOVF9VUkknLCAnJGh0dHAnLCAnJHEnLCAnYXV0aFRva2VuJyxcbmZ1bmN0aW9uICggbG9nLCBFTkRQT0lOVF9VUkksICRodHRwLCAkcSwgYXV0aFRva2VuICkge1xuXG5cdFx0dmFyIGlkZW50aXR5ID0gbnVsbDtcblx0XHR2YXIgX2lkZW50aXR5UmVzb2x2ZWQgPSBmYWxzZTtcblxuXHRcdGZ1bmN0aW9uIGF1dGhvcml6ZSggZm9yY2UgKSB7XG5cblx0XHRcdHZhciBkZWZlcnJlZCA9ICRxLmRlZmVyKCk7XG5cblx0XHRcdGlmICggZm9yY2UgKSBpZGVudGl0eSA9IG51bGw7XG5cblx0XHRcdGlmICggaWRlbnRpdHkgIT09IG51bGwgKSB7XG5cblx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggdHJ1ZSApO1xuXG5cdFx0XHR9IGVsc2Uge1xuXG5cdFx0XHRcdCRodHRwLmdldCggRU5EUE9JTlRfVVJJICsgJ2F1dGgnLCB7IHJlcXVpcmVBdXRoOiB0cnVlIH0gKVxuXHRcdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdhdXRoLmF1dGhvcml6ZSgpOicsIHJlcywgcmVzLmRhdGEgKTtcblx0XHRcdFx0XHRcdGlkZW50aXR5ID0gcmVzLmRhdGE7XG5cdFx0XHRcdFx0XHRfaWRlbnRpdHlSZXNvbHZlZCA9IHRydWU7XG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XG5cblx0XHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2F1dGhvcml6ZScsIGVyciwgZXJyLmRhdGEgKTtcblx0XHRcdFx0XHRcdC8vIHRvZG8gaWYgand0IGV4cGlyZWQgLCBkZWF1dGhvcml6ZSwgcmVtb3ZlIGxvY2FsIHN0b3JhZ2UsIHJlZGlyZWN0XG5cdFx0XHRcdFx0XHRfaWRlbnRpdHlSZXNvbHZlZCA9IHRydWU7XG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZWplY3QoIGVyciApO1xuXG5cdFx0XHRcdFx0fSApO1xuXG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBkZWZlcnJlZC5wcm9taXNlO1xuXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gZGVhdXRob3JpemUoKSB7XG5cdFx0XHRhdXRoVG9rZW4ucmVtb3ZlVG9rZW4oKTtcblx0XHRcdGlkZW50aXR5ID0gbnVsbDtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBpc0F1dGhlbnRpY2F0ZWQoKSB7XG5cdFx0XHRyZXR1cm4gaWRlbnRpdHkgIT09IG51bGw7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gaWRlbnRpdHlSZXNvbHZlZCgpIHtcblx0XHRcdHJldHVybiBfaWRlbnRpdHlSZXNvbHZlZDtcblx0XHR9XG5cblx0XHRyZXR1cm4ge1xuXG5cdFx0XHRhdXRob3JpemUsXG5cdFx0XHRkZWF1dGhvcml6ZSxcblx0XHRcdGlzQXV0aGVudGljYXRlZCxcblx0XHRcdGlkZW50aXR5UmVzb2x2ZWRcblxuXHRcdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnYXV0aFRva2VuJywgZnVuY3Rpb24gKCBhdXRoVG9rZW4gKSB7XG5cblx0ZnVuY3Rpb24gcmVxdWVzdCggY29uZmlnICkge1xuXG5cdFx0aWYgKCBjb25maWcucmVxdWlyZUF1dGggKSB7XG5cdFx0XHR2YXIgdG9rZW4gPSBhdXRoVG9rZW4uZ2V0VG9rZW4oKTtcblx0XHRcdGlmICggdG9rZW4gKSB7XG5cdFx0XHRcdC8vIGh0dHA6Ly9zZWxmLWlzc3VlZC5pbmZvL2RvY3MvZHJhZnQtaWV0Zi1vYXV0aC12Mi1iZWFyZXIuaHRtbCAgIHNlY3Rpb24gMi4xXG5cdFx0XHRcdC8vIGh0dHBzOi8vZGV2ZWxvcGVycy5nb29nbGUuY29tL2dtYWlsL21hcmt1cC9hY3Rpb25zL3ZlcmlmeWluZy1iZWFyZXItdG9rZW5zXG5cdFx0XHRcdC8vIGh0dHA6Ly93d3cudzMub3JnL1Byb3RvY29scy9yZmMyNjE2L3JmYzI2MTYtc2VjNC5odG1sIHNlY3Rpb24gNC4yIGhlYWRlciBmaWVsZCBuYW1lIGNhc2UgaW5zZW5zaXRpdmVcblx0XHRcdFx0Y29uZmlnLmhlYWRlcnMuQXV0aG9yaXphdGlvbiA9ICdCZWFyZXIgJyArIHRva2VuO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiBjb25maWc7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHJlc3BvbnNlKCByZXMgKSB7XG5cdFx0cmV0dXJuIHJlcztcblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRyZXF1ZXN0LFxuXHRcdHJlc3BvbnNlXG5cblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHdpbmRvdycsIGZ1bmN0aW9uICggbG9nLCAkd2luZG93ICkge1xuXG5cdHZhciBzdG9yYWdlID0gJHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG5cdHZhciBjYWNoZWRUb2tlbiA9IG51bGw7XG5cblx0ZnVuY3Rpb24gc2V0VG9rZW4oIHRva2VuICkge1xuXHRcdGNhY2hlZFRva2VuID0gdG9rZW47XG5cdFx0c3RvcmFnZS5zZXRJdGVtKCAnand0JywgdG9rZW4gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdldFRva2VuKCkge1xuXHRcdGlmICggIWNhY2hlZFRva2VuICkge1xuXHRcdFx0Y2FjaGVkVG9rZW4gPSBzdG9yYWdlLmdldEl0ZW0oICdqd3QnICk7XG5cdFx0fVxuXHRcdHJldHVybiBjYWNoZWRUb2tlbjtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZVRva2VuKCkge1xuXHRcdGNhY2hlZFRva2VuID0gbnVsbDtcblx0XHRzdG9yYWdlLnJlbW92ZUl0ZW0oICdqd3QnICk7XG5cdFx0bG9nLmRlYnVnKCAnYXV0aCcsICd0b2tlbiByZW1vdmVkJyApO1xuXHR9XG5cblx0ZnVuY3Rpb24gaGFzVG9rZW4oKSB7XG5cdFx0cmV0dXJuICEhZ2V0VG9rZW4oKTtcblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRzZXRUb2tlbixcblx0XHRnZXRUb2tlbixcblx0XHRyZW1vdmVUb2tlbixcblx0XHRoYXNUb2tlblxuXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICckaHR0cCcsICdFTkRQT0lOVF9VUkknLCAnYXV0aFRva2VuJywgJyRzdGF0ZScsXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApICB7XG5cblx0dmFyIHZtID0gdGhpcztcblx0dm0udXNlciA9IHtcblx0XHRlbWFpbDogJycsXG5cdFx0cGFzc3dvcmQ6ICcnXG5cdH07XG5cblx0dm0uc2lnbmluID0gZnVuY3Rpb24oKSB7XG5cblx0XHRpZiAoIHZtLnVzZXIuZW1haWwgPT09ICcnIHx8IHZtLnVzZXIucGFzc3dvcmQgPT09ICcnICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdlbWFpbCAmIHBhc3N3b3JkIHJlcXVpcmVkLicgKTtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cblx0XHQkaHR0cC5wb3N0KCBFTkRQT0lOVF9VUkkgKyAnc2lnbmluJywgdm0udXNlciApXG5cdFx0XHQudGhlbiggZnVuY3Rpb24oIHJlcyApIHtcblx0XHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdzaWduaW4nLCByZXMsIHJlcy5kYXRhICk7XG5cdFx0XHRcdGF1dGhUb2tlbi5zZXRUb2tlbiggcmVzLmRhdGEudG9rZW4gKTtcblx0XHRcdFx0JHN0YXRlLmdvKCAnY29sbGVjdGlvbicgKTtcblx0XHRcdH0sIGZ1bmN0aW9uKCBlcnIsIHN0YXR1cyApIHtcblx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NpZ25pbicsIGVyciApO1xuXHRcdFx0fSApO1xuXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCAkc3RhdGUsIGF1dGgsIG1vdmllQ29sbGVjdGlvbiApICB7XG5cblx0YXV0aC5kZWF1dGhvcml6ZSgpO1xuXHRtb3ZpZUNvbGxlY3Rpb24uX2NsZWFyKCk7XG5cdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsICRodHRwLCBFTkRQT0lOVF9VUkksIGF1dGhUb2tlbiwgJHN0YXRlICkge1xuXG5cdFx0dmFyIHZtID0gdGhpcztcblx0XHR2bS51c2VyID0ge307XG5cblx0XHR2bS5zaWdudXAgPSBmdW5jdGlvbiAoKSB7XG5cblx0XHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gdW5kZWZpbmVkIHx8IHZtLnVzZXIucGFzc3dvcmQgPT09IHVuZGVmaW5lZCApIHtcblx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsICdlbWFpbCAmIHBhc3N3b3JkIHJlcXVpcmVkLicgKTtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ3NpZ25pbmcgdXAuLi4nICk7XG5cdFx0XHQkaHR0cC5wb3N0KCBFTkRQT0lOVF9VUkkgKyAnc2lnbnVwJywgdm0udXNlciApXG5cdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnUmVnaXN0ZXJlZC4nLCByZXMgKTtcblxuXHRcdFx0XHRcdGF1dGhUb2tlbi5zZXRUb2tlbiggcmVzLmRhdGEudG9rZW4gKTtcblx0XHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xuXG5cdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgZXJyICk7XG5cdFx0XHRcdFx0dm0uZm9ybS4kc3VibWl0dGVkID0gZmFsc2U7XG5cblx0XHRcdFx0fSApO1xuXG5cdFx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckcm9vdFNjb3BlJywgZnVuY3Rpb24gKCAkcm9vdFNjb3BlICkge1xuXG5cdHZhciBFVlQgPSB7XG5cblx0XHRFT1A6IHtcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdFT1AnLCBjYiApOyB9LFxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdFT1AnICk7IH1cblx0XHR9LFxuXHRcdGNvbGxlY3Rpb25Nb2RhbE9wZW46IHtcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdjb2xsZWN0aW9uTW9kYWxPcGVuJywgY2IgKTsgfSxcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnY29sbGVjdGlvbk1vZGFsT3BlbicgKTsgfVxuXHRcdH0sXG5cdFx0Y29sbGVjdGlvbk1vZGFsQ2xvc2U6IHtcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdjb2xsZWN0aW9uTW9kYWxDbG9zZScsIGNiICk7IH0sXG5cdFx0XHRlbWl0OiBmdW5jdGlvbiAoKSB7ICRyb290U2NvcGUuJGJyb2FkY2FzdCggJ2NvbGxlY3Rpb25Nb2RhbENsb3NlJyApOyB9XG5cdFx0fVxuXG5cdH07XG5cblx0cmV0dXJuIEVWVDtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcblxuXHR2YXIgZGVidWdFbmFibGVkID0gZmFsc2U7XG5cdHZhciBkZWJ1Z05hbWVzcGFjZXMgPSBbXTtcblxuXHR0aGlzLmVuYWJsZURlYnVnID0gZnVuY3Rpb24gKCkge1xuXHRcdGRlYnVnRW5hYmxlZCA9IHRydWU7XG5cdH07XG5cblx0dGhpcy5lbmFibGVEZWJ1Z05hbWVzcGFjZSA9IGZ1bmN0aW9uICgpIHtcblx0XHRmb3IgKCBsZXQgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKysgKSB7XG5cdFx0XHRkZWJ1Z05hbWVzcGFjZXMucHVzaCggYXJndW1lbnRzWyBpIF0gKTtcblx0XHR9XG5cdH07XG5cblx0dGhpcy4kZ2V0ID0gKCkgPT4ge1xuXG5cdFx0ZnVuY3Rpb24gZGVidWcoKSB7XG5cdFx0XHRpZiAoICFkZWJ1Z0VuYWJsZWQgKSByZXR1cm47XG5cdFx0XHR2YXIgZGVidWdOYW1lID0gYXJndW1lbnRzWyAwIF07XG5cdFx0XHR2YXIgc2xpY2VkQXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKCBhcmd1bWVudHMsIDEgKTtcblx0XHRcdGlmICggZGVidWdOYW1lID09PSAnZXJyJyApIHtcblx0XHRcdFx0Y29uc29sZS5lcnJvci5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lID09PSAnaW5mbycgKSB7XG5cdFx0XHRcdGNvbnNvbGUuaW5mby5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lID09PSAnd2FybicgKSB7XG5cdFx0XHRcdGNvbnNvbGUud2Fybi5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lc3BhY2VzLmluZGV4T2YoIGRlYnVnTmFtZSApICE9PSAtMSApIHtcblx0XHRcdFx0Y29uc29sZS5sb2cuYXBwbHkoIGNvbnNvbGUsIFsgZGVidWdOYW1lIF0uY29uY2F0KCBzbGljZWRBcmdzICkgKTtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4ge1xuXHRcdFx0ZGVidWdcblx0XHR9O1xuXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyBmdW5jdGlvbiAoKSB7XG5cblx0ZnVuY3Rpb24gZGVib3VuY2UoIGZ1bmMsIHdhaXQsIGltbWVkaWF0ZSApIHtcblx0XHR2YXIgX3RoaXMgPSB0aGlzLFxuXHRcdFx0X2FyZ3VtZW50cyA9IGFyZ3VtZW50cztcblxuXHRcdHZhciB0aW1lb3V0O1xuXHRcdHJldHVybiBmdW5jdGlvbiAoKSB7XG5cblx0XHRcdHZhciBjb250ZXh0ID0gX3RoaXMsXG5cdFx0XHRcdGFyZ3MgPSBfYXJndW1lbnRzO1xuXHRcdFx0dmFyIGxhdGVyID0gZnVuY3Rpb24gbGF0ZXIoKSB7XG5cblx0XHRcdFx0dGltZW91dCA9IG51bGw7XG5cdFx0XHRcdGlmICggIWltbWVkaWF0ZSApIGZ1bmMuYXBwbHkoIGNvbnRleHQsIGFyZ3MgKTtcblx0XHRcdH07XG5cdFx0XHR2YXIgY2FsbE5vdyA9IGltbWVkaWF0ZSAmJiAhdGltZW91dDtcblx0XHRcdGNsZWFyVGltZW91dCggdGltZW91dCApO1xuXHRcdFx0dGltZW91dCA9IHNldFRpbWVvdXQoIGxhdGVyLCB3YWl0ICk7XG5cdFx0XHRpZiAoIGNhbGxOb3cgKSBmdW5jLmFwcGx5KCBjb250ZXh0LCBhcmdzICk7XG5cdFx0fTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0ZGVib3VuY2Vcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckaHR0cFByb3ZpZGVyJywgZnVuY3Rpb24gKCAkaHR0cFByb3ZpZGVyICkge1xuXHQkaHR0cFByb3ZpZGVyLmludGVyY2VwdG9ycy5wdXNoKCAnYXV0aEludGVyY2VwdG9yJyApO1xufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2dQcm92aWRlcicsICckaHR0cFByb3ZpZGVyJywgZnVuY3Rpb24gKCBsb2dQcm92aWRlciwgJGh0dHBQcm92aWRlciApIHtcblxuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1ZygpO1xuXHQvLyBsb2dQcm92aWRlci5lbmFibGVEZWJ1Z05hbWVzcGFjZSggJ2luZm8nLCAnZXJyJywgJ2F1dGgnLCAnYXBpJywgJ2NvbGxlY3Rpb24nICk7XG5cdGxvZ1Byb3ZpZGVyLmVuYWJsZURlYnVnTmFtZXNwYWNlKCAnaW5mbycsICdlcnInICk7XG5cblx0JGh0dHBQcm92aWRlci51c2VMZWdhY3lQcm9taXNlRXh0ZW5zaW9ucyggZmFsc2UgKTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGVQcm92aWRlcicsICckdXJsUm91dGVyUHJvdmlkZXInLCAnJGh0dHBQcm92aWRlcicsXG5mdW5jdGlvbiAoICRzdGF0ZVByb3ZpZGVyLCAkdXJsUm91dGVyUHJvdmlkZXIsICRodHRwUHJvdmlkZXIgKSB7XG5cblx0JHVybFJvdXRlclByb3ZpZGVyLm90aGVyd2lzZSggJy8nICk7XG5cblx0JHN0YXRlUHJvdmlkZXJcblx0XHQuc3RhdGUoICdoZWxpeCcsIHtcblx0XHRcdHVybDogJy8nLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2hlbGl4Lmh0bWwnXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnc2lnbnVwJywge1xuXHRcdFx0dXJsOiAnL3NpZ251cCcsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvc2lnbnVwLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ251cEN0cmwnLFxuXHRcdFx0Y29udHJvbGxlckFzOiAnc2lnbnVwJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ3NpZ25pbicsIHtcblx0XHRcdHVybDogJy9zaWduaW4nLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL3NpZ25pbi5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWduaW5DdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ3NpZ25pbidcblx0XHR9IClcblx0XHQuc3RhdGUoICdzaWdub3V0Jywge1xuXHRcdFx0dXJsOiAnL3NpZ25vdXQnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ25vdXRDdHJsJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ21vdmllRGV0YWlsJywge1xuXHRcdFx0dXJsOiAnL21vdmllLzptb3ZpZUlkJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9tb3ZpZURldGFpbC5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdtb3ZpZURldGFpbEN0cmwnLFxuXHRcdFx0Y29udHJvbGxlckFzOiAnbWQnLFxuXHRcdFx0cmVzb2x2ZToge1xuXHRcdFx0XHRtb3ZpZUl0ZW06IFsgJyRzdGF0ZVBhcmFtcycsICdUTURiJywgZnVuY3Rpb24gKCAkc3RhdGVQYXJhbXMsIFRNRGIgKSB7XG5cdFx0XHRcdFx0cmV0dXJuIFRNRGIuc2VhcmNoQnlJZCggJHN0YXRlUGFyYW1zLm1vdmllSWQgKTtcblx0XHRcdFx0fSBdXG5cdFx0XHR9XG5cdFx0fSApXG5cdFx0LnN0YXRlKCdjb2xsZWN0aW9uJywge1xuXHRcdFx0dXJsOiAnL2NvbGxlY3Rpb24nLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2NvbGxlY3Rpb24uaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnbW92aWVDb2xsZWN0aW9uQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdtYycsXG5cdFx0XHRyZXNvbHZlOiB7XG5cdFx0XHRcdGF1dGhvcml6ZTogWyAnYXV0aCcsIGZ1bmN0aW9uICggYXV0aCApIHtcblx0XHRcdFx0XHRyZXR1cm4gYXV0aC5hdXRob3JpemUoKTtcblx0XHRcdFx0fSBdLFxuXHRcdFx0XHRyZXNvbHZlZENvbGxlY3Rpb246IFsgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggbW92aWVDb2xsZWN0aW9uICkge1xuXHRcdFx0XHRcdHJldHVybiBtb3ZpZUNvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTtcblx0XHRcdFx0fSBdXG5cdFx0XHR9XG5cdFx0fSlcblx0O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCAnRU5HSU5FJywgJ3V0aWwnLCBmdW5jdGlvbiAoICR3aW5kb3csIEVOR0lORSwgdXRpbCApIHtcblxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRlbGVtZW50ICkge1xuXG5cdFx0RU5HSU5FLmF0dGFjaFJlbmRlcmVyKCAkZWxlbWVudCApO1xuXHRcdCQoICR3aW5kb3cgKS5vbiggJ3Jlc2l6ZScsIHV0aWwuZGVib3VuY2UoIEVOR0lORS5vbldpbmRvd1Jlc2l6ZSwgMTAwICkgKTtcblx0XHQkZWxlbWVudC5vbiggJ3doZWVsJywgZnVuY3Rpb24gKCBldnQgKSB7XG5cdFx0XHRFTkdJTkUuJCQud2hlZWxfZHkgPSAtTWF0aC5zaWduKCBldnQub3JpZ2luYWxFdmVudC5kZWx0YVkgKTtcblx0XHR9ICk7XG5cblx0XHRFTkdJTkUuc3RhcnQoKTtcblxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZXN0cmljdDogJ0UnLFxuXHRcdHJlcGxhY2U6IHRydWUsXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHR0ZW1wbGF0ZTogJzxkaXYgaWQ9XCJjYW52YXMtY29udGFpbmVyXCI+PC9kaXY+J1xuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCBmdW5jdGlvbiAoICR3aW5kb3cgKSB7XG5cblx0dmFyICQkID0ge1xuXHRcdGNhbnZhczogbnVsbCxcblx0XHRzdGF0czogbmV3IFN0YXRzKCksXG5cdFx0c2NlbmU6IG5ldyBUSFJFRS5TY2VuZSgpLFxuXHRcdHdpZHRoOiAkKHdpbmRvdykud2lkdGgoKSxcblx0XHRoZWlnaHQ6ICQod2luZG93KS5oZWlnaHQoKSxcblx0XHRjYW1lcmE6IG5ldyBUSFJFRS5QZXJzcGVjdGl2ZUNhbWVyYSggNzAsIHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCwgMTAsIDEwMDAwMCApLFxuXHRcdHJlbmRlcmVyOiBuZXcgVEhSRUUuQ1NTM0RSZW5kZXJlcigpLFxuXHRcdHNjcmVlbl9yYXRpbzogdGhpcy53aWR0aCAvIHRoaXMuaGVpZ2h0LFxuXHRcdHBpeGVsX3JhdGlvOiAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMSxcblx0XHRtb3VzZV94OiB0aGlzLndpZHRoICogMC41LFxuXHRcdG1vdXNlX3k6IHRoaXMuaGVpZ2h0ICogMC41LFxuXHRcdHdoZWVsX2R5OiAwXG5cdH07XG5cblx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xuXG5cdGZ1bmN0aW9uIGF0dGFjaFJlbmRlcmVyKCBjYW52YXMgKSB7XG5cdFx0JCQuY2FudmFzID0gY2FudmFzO1xuXHRcdGNhbnZhcy5hcHBlbmQoICQkLnJlbmRlcmVyLmRvbUVsZW1lbnQgKTtcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5zdGF0cy5kb21FbGVtZW50ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBvbldpbmRvd1Jlc2l6ZSgpIHtcblx0XHQkJC53aWR0aCA9ICQod2luZG93KS53aWR0aCgpO1xuXHRcdCQkLmhlaWdodCA9ICQod2luZG93KS5oZWlnaHQoKTtcblx0XHQkJC5waXhlbF9yYXRpbyA9ICR3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxO1xuXHRcdCQkLnNjcmVlbl9yYXRpbyA9ICQkLndpZHRoIC8gJCQuaGVpZ2h0O1xuXHRcdCQkLmNhbWVyYS5hc3BlY3QgPSAkJC5zY3JlZW5fcmF0aW87XG5cdFx0JCQuY2FtZXJhLnVwZGF0ZVByb2plY3Rpb25NYXRyaXgoKTtcblx0XHQkJC5yZW5kZXJlci5zZXRTaXplKCAkJC53aWR0aCwgJCQuaGVpZ2h0ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBzZXR1cCgpIHtcblxuXHR9XG5cblx0ZnVuY3Rpb24gdXBkYXRlKCkge1xuXG5cdFx0aWYgKCBNYXRoLmFicyggJCQud2hlZWxfZHkgKSA+IDAuMDAxICkge1xuXHRcdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnkgKz0gJCQud2hlZWxfZHkgKiAxLjA7XG5cdFx0XHQkJC5jYW1lcmEucm90YXRlWSggJCQud2hlZWxfZHkgKiAwLjAyNSApO1xuXHRcdFx0JCQud2hlZWxfZHkgKj0gMC45NTtcblx0XHR9XG5cblx0fVxuXG5cdC8vIC0tLS0gIGRyYXcgbG9vcFxuXHRmdW5jdGlvbiBydW4oKSB7XG5cblx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoIHJ1biApO1xuXHRcdHVwZGF0ZSgpO1xuXHRcdCQkLnJlbmRlcmVyLnJlbmRlciggJCQuc2NlbmUsICQkLmNhbWVyYSApO1xuXHRcdCQkLnN0YXRzLnVwZGF0ZSgpO1xuXG5cdH1cblxuXHRmdW5jdGlvbiBzdGFydCgpIHtcblx0XHRzZXR1cCgpO1xuXHRcdHJ1bigpO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVzZXRDYW1lcmEoKSB7XG5cdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnNldCggMCwgMCwgMCApO1xuXHRcdCQkLmNhbWVyYS5yb3RhdGlvbi5zZXQoIDAsIDAsIDAgKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0JCQsXG5cdFx0YXR0YWNoUmVuZGVyZXIsXG5cdFx0b25XaW5kb3dSZXNpemUsXG5cdFx0c3RhcnQsXG5cdFx0cmVzZXRDYW1lcmEsXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VOR0lORScsICckY29tcGlsZScsICckcm9vdFNjb3BlJyxcbmZ1bmN0aW9uICggbG9nLCBFTkdJTkUsICRjb21waWxlLCAkcm9vdFNjb3BlICkge1xuXG5cdHZhciBhbGxQb3N0ZXJzID0gbmV3IFRIUkVFLk9iamVjdDNEKCk7XG5cdEVOR0lORS4kJC5zY2VuZS5hZGQoIGFsbFBvc3RlcnMgKTtcblxuXHRmdW5jdGlvbiBtYWtlSGVsaXhQb3N0ZXJzKCBwb3N0ZXJPYmplY3RNdWx0aSwgb2Zmc2V0U3RhcnRJZHggKSB7XG5cblx0XHR2YXIgdmVjdG9yID0gbmV3IFRIUkVFLlZlY3RvcjMoKTtcblx0XHR2YXIgcmFkaXVzID0gOTAwO1xuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IHBvc3Rlck9iamVjdE11bHRpLmxlbmd0aDsgaSsrICkge1xuXG5cdFx0XHR2YXIgJGlzb2xhdGVkU2NvcGUgPSAkcm9vdFNjb3BlLiRuZXcoIHRydWUgKTtcblx0XHRcdCRpc29sYXRlZFNjb3BlLm1vdmllSXRlbSA9IHBvc3Rlck9iamVjdE11bHRpWyBpIF07XG5cblx0XHRcdHZhciBwb3N0ZXJEaXJlY3RpdmVFbGVtID0gJGNvbXBpbGUoICc8cG9zdGVyPjwvcG9zdGVyPicgKSggJGlzb2xhdGVkU2NvcGUgKVsgMCBdO1xuXHRcdFx0dmFyIGNzczNkT2JqID0gbmV3IFRIUkVFLkNTUzNET2JqZWN0KCBwb3N0ZXJEaXJlY3RpdmVFbGVtICk7XG5cblx0XHRcdC8vIHRhZyBhbG9nIGFuIGlzb2xhdGVkU2NvcGUgdG8gYmUgZGVzdHJveSB3aGVuIGRpc3Bvc2UgYW4gZWxlbWVudFxuXHRcdFx0Y3NzM2RPYmouc2NvcGUgPSAkaXNvbGF0ZWRTY29wZTtcblxuXHRcdFx0dmFyIGhpZHggPSBpICsgb2Zmc2V0U3RhcnRJZHg7XG5cdFx0XHR2YXIgcGhpID0gaGlkeCAqIDAuMTc1ICsgTWF0aC5QSTtcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnggPSAtIHJhZGl1cyAqIE1hdGguc2luKCBwaGkgKTtcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnkgPSAtICggaGlkeCAqIDggKSArIDIwMDtcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnogPSByYWRpdXMgKiBNYXRoLmNvcyggcGhpICk7XG5cblx0XHRcdHZlY3Rvci5zZXQoIC1jc3MzZE9iai5wb3NpdGlvbi54ICogMiwgY3NzM2RPYmoucG9zaXRpb24ueSwgLWNzczNkT2JqLnBvc2l0aW9uLnogKiAyICk7XG5cblx0XHRcdGNzczNkT2JqLmxvb2tBdCggdmVjdG9yICk7XG5cdFx0XHRhbGxQb3N0ZXJzLmFkZCggY3NzM2RPYmogKTtcblxuXHRcdH1cblxuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY3VyciBwb3N0ZXJzOicsIGFsbFBvc3RlcnMuY2hpbGRyZW4ubGVuZ3RoICk7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIGNsZWFyQWxsKCkge1xuXHRcdGFsbFBvc3RlcnMuY2hpbGRyZW4uZm9yRWFjaCggZnVuY3Rpb24gKCBwb3N0ZXIgKSB7XG5cdFx0XHRwb3N0ZXIuZGlzcG9zZUVsZW1lbnQoKTtcblx0XHRcdHBvc3Rlci5zY29wZS4kZGVzdHJveSgpO1xuXHRcdH0gKTtcblx0XHRhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCA9IDA7IC8vIGNsZWFyIGl0ZW1zXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdG1ha2VIZWxpeFBvc3RlcnMsXG5cdFx0Y2xlYXJBbGxcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsIGZ1bmN0aW9uICggJHN0YXRlLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlICkge1xuXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQgKSB7XG5cblx0XHQvLyAkc2NvcGUubW92aWVJdGVtIG9iaiBpcyBwYXNzZWQgdGhydSBpc29sYXRlZFNjb3BlIHZpYSBjb21waWxlZCBkaXJlY3RpdmUgaW4gaGVsaXguZmFjLmpzXG5cdFx0dmFyIGltZyA9IG5ldyBJbWFnZSgpO1xuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC93MTU0LycgKyAkc2NvcGUubW92aWVJdGVtLnBvc3Rlcl9wYXRoO1xuXHRcdGltZy5vbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG5cblx0XHRcdC8vIHRvZG8gbW92ZSBjc3MgaW50byBzYXNzLCB1c2UgY2xhc3MgaW5zdGVhZFxuXHRcdFx0JGVsZW1lbnQuY3NzKCB7XG5cdFx0XHRcdCd3aWR0aCc6ICcxNTBweCcsXG5cdFx0XHRcdCdoZWlnaHQnOiAnMjMwcHgnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1yZXBlYXQnOiAnbm8tcmVwZWF0Jyxcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICcxNTBweCAyMzBweCcsXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknLFxuXHRcdFx0XHQnZGlzcGxheSc6ICdub25lJyAvLyByZXF1aXJlZCBmb3IgZmFkZUluIGFuaW1hdGlvblxuXHRcdFx0fSApO1xuXHRcdFx0JGVsZW1lbnQuZmFkZUluKCAxNTAwICk7XG5cblx0XHR9O1xuXHRcdGltZy5zcmMgPSBpbWdVcmw7XG5cblx0XHQkZWxlbWVudC5vbiggJ2NsaWNrJywgZnVuY3Rpb24gKCBldnQgKSB7XG5cdFx0XHQkc3RhdGUuZ28oICdtb3ZpZURldGFpbCcsIHsgbW92aWVJZDogJHNjb3BlLm1vdmllSXRlbS5pZCB9ICk7XG5cdFx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLnNldEFjdGl2ZUl0ZW0oICRzY29wZS5tb3ZpZUl0ZW0gKTtcblx0XHR9ICk7XG5cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRyZXBsYWNlOiB0cnVlLFxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXG5cdFx0dGVtcGxhdGU6ICc8ZGl2IGNsYXNzPVwicG9zdGVyRWxlbVwiPjwvZGl2Pidcblx0fTtcblxufSBdO1xuIiwiYW5ndWxhci5tb2R1bGUoICdhcHAnLCBbXG5cdCd1aS5yb3V0ZXInLFxuXHQnbmdBbmltYXRlJ1xuXSApXG4uY29uc3RhbnQoICdFTkRQT0lOVF9VUkknLCAnaHR0cDovL2xvY2FsaG9zdDo4MDAxLycgKVxuLmNvbnN0YW50KCAnVE1EQl9BUEknLCB7XG5cdGtleTogJzM3NGMwMzQyYTY0MDZkZmUwYWViM2RlMmVhMDQyYzU5Jyxcblx0dXJsOiAnaHR0cDovL2FwaS50aGVtb3ZpZWRiLm9yZy8zLydcbn0gKVxuXG4ucHJvdmlkZXIoICdsb2cnLCByZXF1aXJlKCAnLi9jb21tb24vbG9nLnB2LmpzJyApIClcbi5mYWN0b3J5KCAndXRpbCcsIHJlcXVpcmUoICcuL2NvbW1vbi91dGlsLmpzJyApIClcbi5mYWN0b3J5KCAnRVZUJywgcmVxdWlyZSggJy4vY29tbW9uL2V2ZW50cy5mYWMuanMnICkgKVxuXG4uZmFjdG9yeSggJ1RNRGInLCByZXF1aXJlKCAnLi9BUEkvVE1EYi5mYWMuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21haW5DdHJsJywgcmVxdWlyZSggJy4vbWFpbi5jdHJsLmpzJyApIClcbi5mYWN0b3J5KCAnRU5HSU5FJywgcmVxdWlyZSggJy4vaGVsaXgvZW5naW5lLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2hlbGl4JywgcmVxdWlyZSggJy4vaGVsaXgvaGVsaXguZmFjLmpzJyApIClcbi5kaXJlY3RpdmUoICdkaXNwbGF5JywgcmVxdWlyZSggJy4vaGVsaXgvZGlzcGxheS5kaXIuanMnICkgKVxuLmRpcmVjdGl2ZSggJ3Bvc3RlcicsIHJlcXVpcmUoICcuL2hlbGl4L3Bvc3Rlci5kaXIuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21vdmllRGV0YWlsQ3RybCcsIHJlcXVpcmUoICcuL21vdmllRGV0YWlsLmN0cmwuanMnICkgKVxuXG4uZmFjdG9yeSggJ2F1dGgnLCByZXF1aXJlKCAnLi9hdXRoL2F1dGguZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aFRva2VuJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoVG9rZW4uZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aEludGVyY2VwdG9yJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzJyApIClcbi5jb250cm9sbGVyKCAnc2lnbnVwQ3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbnVwLmN0cmwuanMnICkgKVxuLmNvbnRyb2xsZXIoICdzaWduaW5DdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWduaW4uY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ25vdXRDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdub3V0LmN0cmwuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21vdmllQ29sbGVjdGlvbkN0cmwnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmN0cmwuanMnICkgKVxuLmZhY3RvcnkoICdtb3ZpZUNvbGxlY3Rpb24nLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsU2VydmljZS5mYWMuanMnICkgKVxuLmRpcmVjdGl2ZSggJ2NvbGxlY3Rpb25Nb2RhbCcsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWwuZGlyLmpzJyApIClcbi5kaXJlY3RpdmUoICdjb2xsZWN0aW9uSXRlbScsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uSXRlbS5kaXIuanMnICkgKVxuXG4uY29uZmlnKCByZXF1aXJlKCAnLi9jb25maWcvcm91dGVDb25maWcuanMnICkgKVxuLmNvbmZpZyggcmVxdWlyZSggJy4vY29uZmlnL2xvZ0NvbmZpZy5qcycgKSApXG4uY29uZmlnKCByZXF1aXJlKCAnLi9jb25maWcvaHR0cENvbmZpZy5qcycgKSApXG4ucnVuKCBbICdsb2cnLCAnJHJvb3RTY29wZScsICckc3RhdGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoIGxvZywgJHJvb3RTY29wZSwgJHN0YXRlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSB7XG5cblx0YXV0aC5hdXRob3JpemUoIHRydWUgKTtcblxuXHRtb3ZpZUNvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTtcblxuXHQkcm9vdFNjb3BlLiRvbiggJyRzdGF0ZUNoYW5nZUVycm9yJywgZnVuY3Rpb24gKCBldmVudCwgdG9TdGF0ZSwgdG9QYXJhbXMsIGZyb21TdGF0ZSwgZnJvbVBhcmFtcywgZXJyb3IgKSB7XG5cblx0XHRldmVudC5wcmV2ZW50RGVmYXVsdCgpOyAvLyBwcmV2ZW50IHRyYW5zaXRpb25cblx0XHRsb2cuZGVidWcoICd3YXJuJywgZXJyb3IgKTtcblx0XHRpZiAoIGVycm9yICkge1xuXHRcdFx0JHN0YXRlLmdvKCAnc2lnbmluJyApO1xuXHRcdH1cblxuXHR9ICk7XG5cbn0gXSApXG47XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnVE1EYicsICdFVlQnLCAnaGVsaXgnLCAnRU5HSU5FJywgJ2F1dGgnLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsIFRNRGIsIEVWVCwgaGVsaXgsIEVOR0lORSwgYXV0aCwgJHN0YXRlICkge1xuXG5cdHZhciB2bSA9IHRoaXM7XG5cdHZtLmF1dGggPSBhdXRoO1xuXHR2bS5zZWFyY2ggPSB7XG5cdFx0cXVlcnk6ICcnLFxuXHR9O1xuXHR2bS5tb3ZpZUl0ZW1zID0gbnVsbDtcblxuXHQkc2NvcGUuJHdhdGNoKCBUTURiLmdldFJlcywgZnVuY3Rpb24gKCBtb3ZJdGVtcyApIHtcblxuXHRcdHZtLm1vdmllSXRlbXMgPSBtb3ZJdGVtcztcblx0XHRoZWxpeC5tYWtlSGVsaXhQb3N0ZXJzKCBtb3ZJdGVtcy5zbGljZSggVE1EYi5wcmV2UmVzdWx0TGVuICksIFRNRGIucHJldlJlc3VsdExlbiApO1xuXG5cdH0sIHRydWUgKTtcblxuXHR2YXIgcHJldlF1ZXJ5ID0gJyc7XG5cdHZtLnNlYXJjaCA9IGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIHZtLnNlYXJjaC5xdWVyeSA9PT0gJycgKSByZXR1cm47XG5cdFx0aWYgKCBwcmV2UXVlcnkgIT09IHZtLnNlYXJjaC5xdWVyeSApIHtcblx0XHRcdHByZXZRdWVyeSA9IHZtLnNlYXJjaC5xdWVyeTtcblx0XHRcdFRNRGIuY2xlYXJTZWFyY2goKTtcblx0XHRcdGhlbGl4LmNsZWFyQWxsKCk7XG5cdFx0XHRFTkdJTkUucmVzZXRDYW1lcmEoKTtcblx0XHR9XG5cdFx0aWYgKCAkc3RhdGUuY3VycmVudC5uYW1lICE9PSAnaGVsaXgnICkge1xuXHRcdFx0JHN0YXRlLmdvKCAnaGVsaXgnICk7XG5cdFx0fVxuXHRcdFRNRGIuc2VhcmNoQnlUaXRsZSggdm0uc2VhcmNoICk7XG5cdH07XG5cblx0Ly8gREVCVUdcblx0d2luZG93LlNDT1BFID0gJHNjb3BlO1xuXHR2bS5UTURiID0gVE1EYjtcblx0dm0uaGVsaXggPSBoZWxpeDtcblx0dm0uRU5HSU5FID0gRU5HSU5FO1xuXHR2bS5TVEFURSA9ICRzdGF0ZTtcblxuXHRFVlQuRU9QLmxpc3RlbiggZnVuY3Rpb24gKCkge1xuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAncmVjaWV2ZWQgRU9QIGV2ZW50IScgKTtcblx0fSApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdUTURiJywgZnVuY3Rpb24gKCBsb2csIFRNRGIgKSB7XG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkYXR0cnMsICRlbGVtZW50ICkge1xuXG5cdFx0VE1EYi5zZWFyY2hCeUlkKCBwYXJzZUludCggJHNjb3BlLm1vdmllSWQgKSApXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXG5cdFx0XHQvLyBsb2cuZGVidWcoICdpbmZvJywgJ2NvbGxlY3Rpb25JdGVtRGlyZWN0aXZlJywgcmVzICk7XG5cdFx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3AvdzkyLycgKyByZXMucG9zdGVyX3BhdGg7XG5cdFx0XHQkZWxlbWVudC5jc3MoIHtcblx0XHRcdFx0J3dpZHRoJzogJzEwMCUnLFxuXHRcdFx0XHQnaGVpZ2h0JzogJzEwMCUnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1yZXBlYXQnOiAnbm8tcmVwZWF0Jyxcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICcxMDAlIDEwMCUnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJ1xuXHRcdFx0fSApO1xuXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbkl0ZW1EaXJlY3RpdmUnLCBlcnIgKTtcblx0XHR9ICk7XG5cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRyZXBsYWNlOiB0cnVlLFxuXHRcdHNjb3BlOiB7IG1vdmllSWQ6ICdAJyB9LFxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXG5cdFx0Y29udHJvbGxlckFzOiAnY2knLFxuXHRcdHRlbXBsYXRlOiAnPGRpdj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ21vdmllQ29sbGVjdGlvbicsICdjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlJywgJ0VWVCcsXG5mdW5jdGlvbiAoIGxvZywgbW92aWVDb2xsZWN0aW9uLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLCBFVlQgKSB7XG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCwgJGF0dHJzICkge1xuXG5cdFx0dmFyIHZtID0gdGhpcztcblx0XHR2bS5tb3ZpZUNvbGxlY3Rpb24gPSBtb3ZpZUNvbGxlY3Rpb247XG5cdFx0dm0uY29sbGVjdGlvbk1vZGFsU2VydmljZSA9IGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2U7XG5cblx0XHR2bS5hZGRpbmdOZXdDb2xsZWN0aW9uID0gZmFsc2U7XG5cblx0XHR2bS5vcGVuRWRpdG9yID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IHRydWU7XG5cdFx0fTtcblxuXHRcdHZtLmNsb3NlRWRpdG9yID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xuXHRcdH07XG5cblx0XHR2bS5jcmVhdGVOZXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0bW92aWVDb2xsZWN0aW9uLmNyZWF0ZSggJHNjb3BlLm5ld0NvbGxlY3Rpb25OYW1lICk7XG5cdFx0XHR2bS5jbG9zZUVkaXRvcigpO1xuXHRcdH07XG5cblx0XHR2bS5hZGRUb0NvbGxlY3Rpb24gPSBmdW5jdGlvbiAoIG1vdmllSWQsIGNvbGxlY3Rpb25OYW1lICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdhZGRUb0NvbGxlY3Rpb246JywgbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKTtcblx0XHRcdHZhciBzdWNjZXNzID0gbW92aWVDb2xsZWN0aW9uLnB1c2goIG1vdmllSWQsIGNvbGxlY3Rpb25OYW1lICk7XG5cdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ21vdmllQ29sbGVjdGlvbi5wdXNoJywgc3VjY2VzcyApO1xuXHRcdH07XG5cblx0XHQvLyBkZWZhdWx0IGNzcyBhdCBkaXJlY3RpdmUgaW5pdGlhbGl6YXRpb25cblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xuXG5cdFx0RVZULmNvbGxlY3Rpb25Nb2RhbE9wZW4ubGlzdGVuKCBmdW5jdGlvbiAoKSB7XG5cdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb25Nb2RhbE9wZW4nICk7XG5cdFx0JGVsZW1lbnQuY3NzKCB7IHZpc2liaWxpdHk6ICd2aXNpYmxlJyB9ICk7XG5cdFx0fSApO1xuXG5cdFx0RVZULmNvbGxlY3Rpb25Nb2RhbENsb3NlLmxpc3RlbiggZnVuY3Rpb24gKCkge1xuXHRcdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdjb2xsZWN0aW9uTW9kYWxDbG9zZScgKTtcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xuXHRcdH0gKTtcblxuXHR9XG5cblx0cmV0dXJuIHtcblxuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0c2NvcGU6IHt9LFxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXG5cdFx0Y29udHJvbGxlckFzOiAnbW9kYWwnLFxuXHRcdHJlcGxhY2U6IHRydWUsXG5cdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2NvbGxlY3Rpb25Nb2RhbC5odG1sJ1xuXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VWVCcsIGZ1bmN0aW9uICggbG9nLCBFVlQgKSB7XG5cblx0dmFyIGFjdGl2ZUl0ZW0gPSBudWxsO1xuXG5cdGZ1bmN0aW9uIHNldEFjdGl2ZUl0ZW0oIGl0ZW0gKSB7XG5cdFx0YWN0aXZlSXRlbSA9IGl0ZW07XG5cdH1cblxuXHRmdW5jdGlvbiBnZXRBY3RpdmVJdGVtKCBpdGVtICkge1xuXHRcdHJldHVybiBhY3RpdmVJdGVtO1xuXHR9XG5cblx0ZnVuY3Rpb24gb3BlbigpIHtcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsT3Blbi5lbWl0KCk7XG5cdH1cblxuXHRmdW5jdGlvbiBjbG9zZSgpIHtcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UuZW1pdCgpO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRzZXRBY3RpdmVJdGVtLFxuXHRcdGdldEFjdGl2ZUl0ZW0sXG5cdFx0b3Blbixcblx0XHRjbG9zZVxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoIGxvZywgJHNjb3BlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSAge1xuXG5cdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbkN0cmwnLCBtb3ZpZUNvbGxlY3Rpb24uZ2V0Q29sbGVjdGlvbigpICk7XG5cdHZhciB2bSA9IHRoaXM7XG5cdHZtLm1vdmllQ29sbGVjdGlvbiA9IG1vdmllQ29sbGVjdGlvbjtcblxuXHR2bS52aWV3Q29sbGVjdGlvbiA9IGZ1bmN0aW9uICggY29sbGVjdGlvbiApIHtcblx0XHRjb25zb2xlLmxvZyggY29sbGVjdGlvbiApO1xuXHRcdC8qIGNhbGwgbW92aWVDb2xsZWN0aW9uLmZldGNoQWxsKClcblx0XHRcdGNsZWFySGVsaXgoKVxuXHRcdFx0Y2FsbCBtYWtlIGhlbGl4IHcvIGZldGNoZWQgcmVzdWx0XG5cdFx0XHR1aSBzdGF0ZSAtPiBoZWxpeFxuXHRcdCovXG5cdH07XG5cblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5EUE9JTlRfVVJJJywgJyRodHRwJywgJyRxJywgZnVuY3Rpb24gKCBsb2csIEVORFBPSU5UX1VSSSwgJGh0dHAsICRxICkge1xuXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdjb2xsZWN0aW9uJztcblx0dmFyIGNvbGxlY3Rpb24gPSBudWxsO1xuXG5cdHZhciBmdWxsQ29sbGVjdGlvbiA9IG51bGw7XG5cblx0ZnVuY3Rpb24gY3JlYXRlKCBuYW1lICkge1xuXHRcdGNvbGxlY3Rpb24ucHVzaCggeyBjb2xsZWN0aW9uTmFtZTogbmFtZSwgbW92aWVzOiBbXSB9ICk7XG5cdFx0cHV0KCk7XG5cdH1cblxuXHRmdW5jdGlvbiBpc0VtcHR5KCkge1xuXHRcdHJldHVybiBjb2xsZWN0aW9uLmxlbmd0aCA9PT0gMDtcblx0fVxuXG5cdGZ1bmN0aW9uIGZldGNoQWxsKCBjb2xsZWN0aW9uTmFtZSApIHtcblxuXHR9XG5cblx0ZnVuY3Rpb24gcmVzb2x2ZUNvbGxlY3Rpb24oKSB7XG5cblx0XHR2YXIgZGVmZXJyZWQgPSAkcS5kZWZlcigpO1xuXG5cdFx0aWYgKCBjb2xsZWN0aW9uICE9PSBudWxsICkge1xuXHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggY29sbGVjdGlvbiApO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHQkaHR0cC5nZXQoIERCX0VORFBPSU5ULCB7IHJlcXVpcmVBdXRoOiB0cnVlIH0gKVxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdjb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk6JywgcmVzICk7XG5cdFx0XHRcdFx0aWYgKCByZXMuZGF0YSApIHtcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSByZXMuZGF0YTtcblx0XHRcdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRcdFx0Y29sbGVjdGlvbiA9IFtdO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XG5cdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdjb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk6JywgZXJyICk7XG5cdFx0XHRcdFx0ZGVmZXJyZWQucmVqZWN0KCBlcnIgKTtcblx0XHRcdFx0fSApO1xuXHRcdH1cblxuXHRcdHJldHVybiBkZWZlcnJlZC5wcm9taXNlO1xuXG5cdH1cblxuXHRmdW5jdGlvbiBoYXNJdGVtKCBpdGVtSWQsIHNvbWVDb2xsZWN0aW9uICkge1xuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xuXHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLmNvbGxlY3Rpb25OYW1lID09PSBzb21lQ29sbGVjdGlvbiApIHtcblx0XHRcdFx0Zm9yICggdmFyIGsgPSAwOyBrIDwgY29sbGVjdGlvbltpXS5tb3ZpZXMubGVuZ3RoOyBrICsrICkge1xuXHRcdFx0XHRcdGlmICggY29sbGVjdGlvbltpXS5tb3ZpZXNba10gPT09IGl0ZW1JZCApIHtcblx0XHRcdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblxuXHRmdW5jdGlvbiBwdXQoKSB7XG5cdFx0JGh0dHAucHV0KCBEQl9FTkRQT0lOVCwgY29sbGVjdGlvbiwgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcblx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblx0XHRcdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdjb2xsZWN0aW9uLnB1dCgpOicsIHJlcyApO1xuXHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdjb2xsZWN0aW9uLnB1dCgpOicsIGVyciApO1xuXHRcdFx0fSApO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHVzaCggaXRlbUlkLCB0b0NvbGxlY3Rpb24gKSB7XG5cdFx0aWYgKCBoYXNJdGVtKCBpdGVtSWQsIHRvQ29sbGVjdGlvbiApICkge1xuXHRcdFx0cmV0dXJuIGZhbHNlO1xuXHRcdH1cblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gdG9Db2xsZWN0aW9uICkge1xuXHRcdFx0XHRjb2xsZWN0aW9uW2ldLm1vdmllcy5wdXNoKCBpdGVtSWQgKTtcblx0XHRcdFx0cHV0KCk7XG5cdFx0XHRcdHJldHVybiB0cnVlO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblxuXHRmdW5jdGlvbiByZW1vdmUoIGl0ZW1JZCwgaW5Db2xsZWN0aW9uICkge1xuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xuXHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLmNvbGxlY3Rpb25OYW1lID09PSBpbkNvbGxlY3Rpb24gKSB7XG5cdFx0XHRcdGZvciAoIHZhciBrID0gMDsgayA8IGNvbGxlY3Rpb25baV0ubW92aWVzLmxlbmd0aDsgayArKyApIHtcblx0XHRcdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0ubW92aWVzW2tdID09PSBpdGVtSWQgKSB7XG5cdFx0XHRcdFx0XHR2YXIgcmVtb3ZlZCA9IGNvbGxlY3Rpb25baV0ubW92aWVzLnNwbGljZSggaywgMSApLmxlbmd0aDtcblx0XHRcdFx0XHRcdHB1dCgpO1xuXHRcdFx0XHRcdFx0cmV0dXJuIHJlbW92ZWQgIT09IDA7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZUNvbGxlY3Rpb24oIGNvbGxlY3Rpb25OYW1lICkge1xuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xuXHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLmNvbGxlY3Rpb25OYW1lID09PSBjb2xsZWN0aW9uTmFtZSApIHtcblx0XHRcdFx0dmFyIHJlbW92ZWQgPSBjb2xsZWN0aW9uLnNwbGljZSggaSwgMSApLmxlbmd0aDtcblx0XHRcdFx0cHV0KCk7XG5cdFx0XHRcdHJldHVybiByZW1vdmVkICE9PSAwO1xuXHRcdFx0fVxuXHRcdH1cblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblxuXHRmdW5jdGlvbiBzeW5jKCkge1xuXHRcdC8vIHN5bmMgbG9jYWwgY29sZWxjdGlvbiB3LyBEQlxuXHR9XG5cblx0ZnVuY3Rpb24gZ2V0Q29sbGVjdGlvbigpIHtcblx0XHRyZXR1cm4gY29sbGVjdGlvbjtcblx0fVxuXG5cdGZ1bmN0aW9uIF9jbGVhcigpIHtcblx0XHRjb2xsZWN0aW9uID0gbnVsbDtcblx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2xvY2FsIGNvbGxlY3Rpb24gY2xlYXJlZC4nICk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdGdldENvbGxlY3Rpb24sXG5cdFx0Y3JlYXRlLFxuXHRcdHB1c2gsXG5cdFx0cHV0LFxuXHRcdHJlbW92ZSxcblx0XHRyZW1vdmVDb2xsZWN0aW9uLFxuXHRcdHN5bmMsXG5cdFx0X2NsZWFyLFxuXHRcdHJlc29sdmVDb2xsZWN0aW9uLFxuXHRcdGhhc0l0ZW0sXG5cdFx0aXNFbXB0eVxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnVE1EYicsICckY2FjaGVGYWN0b3J5JywgJ21vdmllSXRlbScsICdjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlJywgJ21vdmllQ29sbGVjdGlvbicsXG5mdW5jdGlvbiggbG9nLCAkc2NvcGUsIFRNRGIsICRjYWNoZUZhY3RvcnksIG1vdmllSXRlbSwgY29sbGVjdGlvbk1vZGFsU2VydmljZSwgbW92aWVDb2xsZWN0aW9uICkge1xuXG5cdHZhciB2bSA9IHRoaXM7XG5cdHZtLm1vdmllSXRlbSA9IG1vdmllSXRlbTsgLy8gbW92aWVJdGVtIGluamVjdGVkIHZpYSBzdGF0ZSByZXNvbHZlXG5cdGxvZy5kZWJ1ZyggJ2N0cmwnLCAnbW92aWVEZXRhaWwgY3RybCByZXNvbHZlZDonLCB2bS5tb3ZpZUl0ZW0gKTtcblxuXHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlO1xuXHRpZiAoIG1vdmllSXRlbS50aXRsZSAhPT0gbW92aWVJdGVtLm9yaWdpbmFsX3RpdGxlICkge1xuXHRcdG1vdmllSXRlbS5mdWxsVGl0bGUgPSBtb3ZpZUl0ZW0udGl0bGUgKyAnICgnICsgbW92aWVJdGVtLm9yaWdpbmFsX3RpdGxlICsgJyknO1xuXHR9XG5cblx0aWYgKCBtb3ZpZUl0ZW0uYmFja2Ryb3BfcGF0aCApIHtcblx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3Avb3JpZ2luYWwnICsgbW92aWVJdGVtLmJhY2tkcm9wX3BhdGg7XG5cdFx0JCggJy5iYWNrZHJvcCcgKS5jc3MoIHtcblx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknXG5cdFx0fSApO1xuXHR9XG5cblx0dm0ub3BlbkNvbGxlY3Rpb25Nb2RhbCA9IGZ1bmN0aW9uICgpIHtcblx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLnNldEFjdGl2ZUl0ZW0oIG1vdmllSXRlbSApO1xuXHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2Uub3BlbigpO1xuXHR9O1xuXG59IF07XG4iXX0=
