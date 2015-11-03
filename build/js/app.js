(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports = ['log', '$http', 'TMDB_API', 'EVT', '$cacheFactory', '$q', 'ENDPOINT_URI', function (log, $http, TMDB_API, EVT, $cacheFactory, $q, ENDPOINT_URI) {

	var searchResult = [];
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
		totalPages = -1;
		currPage = 1;
	}

	return {
		searchByTitle: searchByTitle,
		searchById: searchById,
		clearSearch: clearSearch,
		getRes: getRes,
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

	$scope.$watch(TMDb.getRes, function (movItems, oldMovItems) {

		vm.movieItems = movItems;
		helix.makeHelixPosters(movItems.slice(oldMovItems.length), oldMovItems.length);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL0FQSS9UTURiLmZhYy5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9hdXRoLmZhYy5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhUb2tlbi5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbmluLmN0cmwuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbm91dC5jdHJsLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL3NpZ251cC5jdHJsLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9jb21tb24vZXZlbnRzLmZhYy5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvY29tbW9uL2xvZy5wdi5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvY29tbW9uL3V0aWwuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2NvbmZpZy9odHRwQ29uZmlnLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9jb25maWcvbG9nQ29uZmlnLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9jb25maWcvcm91dGVDb25maWcuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2hlbGl4L2Rpc3BsYXkuZGlyLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9lbmdpbmUuZmFjLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9oZWxpeC5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2hlbGl4L3Bvc3Rlci5kaXIuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2luZGV4LmpzIiwiL1VzZXJzL254L0Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9tYWluLmN0cmwuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uSXRlbS5kaXIuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWwuZGlyLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsU2VydmljZS5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL21vdmllQ29sbGVjdGlvbi9tb3ZpZUNvbGxlY3Rpb24uY3RybC5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL21vdmllRGV0YWlsLmN0cmwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxjQUFjLEVBQzNGLFVBQVcsR0FBRyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFHOztBQUV2RSxLQUFJLFlBQVksR0FBRyxFQUFFLENBQUM7QUFDdEIsS0FBSSxVQUFVLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFDcEIsS0FBSSxRQUFRLEdBQUcsQ0FBQyxDQUFDOztBQUVqQixLQUFJLFlBQVksR0FBRyxhQUFhLENBQUUsY0FBYyxDQUFFLENBQUM7OztBQUduRCxLQUFJLFdBQVcsR0FBRyxZQUFZLEdBQUcsUUFBUSxDQUFDOztBQUUxQyxVQUFTLFdBQVcsQ0FBRSxTQUFTLEVBQUc7O0FBRWpDLE9BQUssQ0FBQyxHQUFHLENBQUUsV0FBVyxHQUFHLFNBQVMsQ0FBQyxFQUFFLEVBQUUsU0FBUyxDQUFFLENBQ2pELElBQUksQ0FBRSxVQUFXLEdBQUcsRUFBRztBQUN2QixNQUFHLENBQUMsS0FBSyxDQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxDQUFFLENBQUM7R0FDaEMsRUFBRSxVQUFXLEdBQUcsRUFBRztBQUNuQixNQUFHLENBQUMsS0FBSyxDQUFFLEtBQUssRUFBRSxNQUFNLEVBQUUsR0FBRyxDQUFFLENBQUM7R0FDaEMsQ0FBRSxDQUFDO0VBQ0o7O0FBRUQsVUFBUyxjQUFjLENBQUUsRUFBRSxFQUFHO0FBQzdCLE1BQUksT0FBTyxHQUFHLEtBQUssQ0FBQyxHQUFHLENBQUUsV0FBVyxHQUFHLEVBQUUsQ0FBRSxDQUMxQyxJQUFJLENBQUUs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c0IsQ0FBQyxhQUFhLENBQUUsU0FBUyxDQUFFLENBQUM7QUFDbEQsd0JBQXNCLENBQUMsSUFBSSxFQUFFLENBQUM7RUFDOUIsQ0FBQztDQUVGLENBQUUsQ0FBQyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckaHR0cCcsICdUTURCX0FQSScsICdFVlQnLCAnJGNhY2hlRmFjdG9yeScsICckcScsICdFTkRQT0lOVF9VUkknLFxuZnVuY3Rpb24gKCBsb2csICRodHRwLCBUTURCX0FQSSwgRVZULCAkY2FjaGVGYWN0b3J5LCAkcSwgRU5EUE9JTlRfVVJJICkge1xuXG5cdHZhciBzZWFyY2hSZXN1bHQgPSBbXTtcblx0dmFyIHRvdGFsUGFnZXMgPSAtMTtcblx0dmFyIGN1cnJQYWdlID0gMTtcblxuXHR2YXIgbW92aWVJZENhY2hlID0gJGNhY2hlRmFjdG9yeSggJ21vdmllSWRDYWNoZScgKTtcblx0Ly8gVE1EQl9BUEkudXJsICsgJ21vdmllL25vd19wbGF5aW5nJ1xuXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdtb3ZpZS8nO1xuXG5cdGZ1bmN0aW9uIHB1dEl0ZW1Ub0RCKCBtb3ZpZUl0ZW0gKSB7XG5cdFx0Ly8gdG9kbyBkb250IHB1dCBleGlzaXRpbmcgaXRlbSBpbiBkYiAoIFVQU0VSVCApXG5cdFx0JGh0dHAucHV0KCBEQl9FTkRQT0lOVCArIG1vdmllSXRlbS5pZCwgbW92aWVJdGVtIClcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnUFVUOicsIHJlcyApO1xuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ1BVVDonLCBlcnIgKTtcblx0XHR9ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBzZWFyY2hJZEZyb21EQiggaWQgKSB7XG5cdFx0dmFyIHByb21pc2UgPSAkaHR0cC5nZXQoIERCX0VORFBPSU5UICsgaWQgKVxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsICdzZWFyY2hCeUlkID0+IERCOicsIHJlcy5kYXRhICk7XG5cdFx0XHRpZiAoIHJlcy5kYXRhICkge1xuXHRcdFx0XHRtb3ZpZUlkQ2FjaGUucHV0KCByZXMuZGF0YS5pZCwgcmVzLmRhdGEgKTtcblx0XHRcdFx0cmV0dXJuIHJlcy5kYXRhO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0cmV0dXJuIG51bGw7XG5cdFx0XHR9XG5cdFx0fSwgZnVuY3Rpb24oIGVyciApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzZWFyY2hCeUlkID0+IERCOicsIGVyciApO1xuXHRcdH0gKTtcblx0XHRyZXR1cm4gcHJvbWlzZTtcblx0fVxuXG5cdGZ1bmN0aW9uIHNlYXJjaElkRnJvbUFQSSggaWQgKSB7XG5cdFx0dmFyIHByb21pc2UgPSAkaHR0cC5nZXQoIFRNREJfQVBJLnVybCArICdtb3ZpZS8nICsgaWQsIHtcblx0XHRcdHBhcmFtczogeyBhcGlfa2V5OiBUTURCX0FQSS5rZXkgfVxuXHRcdH0gKS50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsICdzZWFyY2hCeUlkID0+IEFQSTonLCByZXMuZGF0YSApO1xuXHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XG5cdFx0XHRwdXRJdGVtVG9EQiggcmVzLmRhdGEgKTtcblx0XHRcdHJldHVybiByZXMuZGF0YTtcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzZWFyY2hCeUlkID0+IEFQSTonLCBlcnIgKTtcblx0XHR9ICk7XG5cdFx0cmV0dXJuIHByb21pc2U7XG5cdH1cblxuXHRmdW5jdGlvbiBzZWFyY2hCeUlkKCBpZCApIHtcblxuXHRcdHZhciBkZl9EQiA9ICRxLmRlZmVyKCk7XG5cdFx0dmFyIGRmX1JlcyA9ICRxLmRlZmVyKCk7XG5cblx0XHR2YXIgY2FjaGVkSXRlbSA9IG1vdmllSWRDYWNoZS5nZXQoIGlkICk7XG5cdFx0aWYgKCBjYWNoZWRJdGVtICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgJ3NlYXJjaEJ5SWQgPT4gY2FjaGU6JywgY2FjaGVkSXRlbSApO1xuXHRcdFx0ZGZfUmVzLnJlc29sdmUoIGNhY2hlZEl0ZW0gKTtcblx0XHRcdHJldHVybiBkZl9SZXMucHJvbWlzZTtcblx0XHR9XG5cblx0XHRzZWFyY2hJZEZyb21EQiggaWQgKS50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblx0XHRcdGlmICggcmVzICkge1xuXHRcdFx0XHRkZl9EQi5yZXNvbHZlKCByZXMgKTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdGRmX0RCLnJlamVjdCggJ25vdCBmb3VuZCcgKTtcblx0XHRcdH1cblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdFx0ZGZfREIucmVqZWN0KCBlcnIgKTtcblx0XHR9ICk7XG5cblx0XHRkZl9EQi5wcm9taXNlLnRoZW4oIGZ1bmN0aW9uICggcmVzX0RCICkge1xuXHRcdFx0ZGZfUmVzLnJlc29sdmUoIHJlc19EQiApO1xuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0c2VhcmNoSWRGcm9tQVBJKCBpZCApLnRoZW4oIGZ1bmN0aW9uICggcmVzX2FwaSApIHtcblx0XHRcdFx0ZGZfUmVzLnJlc29sdmUoIHJlc19hcGkgKTtcblx0XHRcdH0sIGZ1bmN0aW9uICggZXJyX2FwaSApIHtcblx0XHRcdFx0ZGZfUmVzLnJlamVjdCggZXJyX2FwaSApO1xuXHRcdFx0fSApO1xuXHRcdH0gKTtcblxuXHRcdHJldHVybiBkZl9SZXMucHJvbWlzZTtcblxuXHR9XG5cblx0ZnVuY3Rpb24gc2VhcmNoQnlUaXRsZSggc2VhcmNoT2JqICkge1xuXG5cdFx0aWYgKCBjdXJyUGFnZSA+IHRvdGFsUGFnZXMgJiYgdG90YWxQYWdlcyAhPT0gLTEgKSB7XG5cdFx0XHQvLyBlbWl0IGV2ZW50IGVuZCBvZiBwYWdlXG5cdFx0XHRFVlQuRU9QLmVtaXQoKTtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cblx0XHQkaHR0cC5nZXQoIFRNREJfQVBJLnVybCArICdzZWFyY2gvbW92aWUnLCB7XG5cdFx0XHRjYWNoZTogdHJ1ZSxcblx0XHRcdHBhcmFtczoge1xuXHRcdFx0XHRhcGlfa2V5OiBUTURCX0FQSS5rZXksXG5cdFx0XHRcdHF1ZXJ5OiBzZWFyY2hPYmoucXVlcnksXG5cdFx0XHRcdHBhZ2U6IGN1cnJQYWdlXG5cdFx0XHR9XG5cdFx0fSApXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXHRcdFx0Ly8gZW1pdCBldmVudCBzZWFyY2ggc3VjY2Vzc1xuXHRcdFx0c2VhcmNoUmVzdWx0ID0gc2VhcmNoUmVzdWx0LmNvbmNhdCggcmVtb3ZlTm9Qb3N0ZXJJdGVtcyggcmVzLmRhdGEucmVzdWx0cyApICk7XG5cdFx0XHR0b3RhbFBhZ2VzID0gcmVzLmRhdGEudG90YWxfcGFnZXM7XG5cdFx0XHRjdXJyUGFnZSArKztcblx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsICdzZWFyY2hCeVRpdGxlOicsIHJlcywgcmVzLmRhdGEgKTtcblxuXHRcdFx0Ly8gY2FjaGVcblx0XHRcdHJlcy5kYXRhLnJlc3VsdHMuZm9yRWFjaCggZnVuY3Rpb24gKCBpdGVtICkge1xuXG5cdFx0XHRcdGlmICggIW1vdmllSWRDYWNoZS5nZXQoIGl0ZW0uaWQgKSApIHtcblx0XHRcdFx0XHRsb2cuZGVidWcoICdhcGknLCBpdGVtLmlkLCBpdGVtICk7XG5cdFx0XHRcdFx0bW92aWVJZENhY2hlLnB1dCggaXRlbS5pZCwgaXRlbSApO1xuXHRcdFx0XHR9XG5cblx0XHRcdH0gKTtcblxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0Ly8gZW1pdCBldmVudCBzZWFyY2ggZXJyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlUaXRsZTonLCBlcnIgKTtcblx0XHR9ICk7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlc3VsdHMgKSB7XG5cdFx0cmV0dXJuIHJlc3VsdHMuZmlsdGVyKCBmdW5jdGlvbiAoIGl0ZW0gKSB7XG5cdFx0XHRyZXR1cm4gISFpdGVtLnBvc3Rlcl9wYXRoO1xuXHRcdH0gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdldFJlcygpIHtcblx0XHRyZXR1cm4gc2VhcmNoUmVzdWx0O1xuXHR9XG5cblx0ZnVuY3Rpb24gY2xlYXJTZWFyY2goKSB7XG5cdFx0Ly8gZW1pdCBldmVudCBjbGVhclNlYWNoXG5cdFx0c2VhcmNoUmVzdWx0Lmxlbmd0aCA9IDA7XG5cdFx0dG90YWxQYWdlcyA9IC0xO1xuXHRcdGN1cnJQYWdlID0gMTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0c2VhcmNoQnlUaXRsZSxcblx0XHRzZWFyY2hCeUlkLFxuXHRcdGNsZWFyU2VhcmNoLFxuXHRcdGdldFJlcyxcblx0XHRwdXRJdGVtVG9EQixcblx0XHRtb3ZpZUlkQ2FjaGVcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5EUE9JTlRfVVJJJywgJyRodHRwJywgJyRxJywgJ2F1dGhUb2tlbicsXG5mdW5jdGlvbiAoIGxvZywgRU5EUE9JTlRfVVJJLCAkaHR0cCwgJHEsIGF1dGhUb2tlbiApIHtcblxuXHRcdHZhciBpZGVudGl0eSA9IG51bGw7XG5cdFx0dmFyIF9pZGVudGl0eVJlc29sdmVkID0gZmFsc2U7XG5cblx0XHRmdW5jdGlvbiBhdXRob3JpemUoIGZvcmNlICkge1xuXG5cdFx0XHR2YXIgZGVmZXJyZWQgPSAkcS5kZWZlcigpO1xuXG5cdFx0XHRpZiAoIGZvcmNlICkgaWRlbnRpdHkgPSBudWxsO1xuXG5cdFx0XHRpZiAoIGlkZW50aXR5ICE9PSBudWxsICkge1xuXG5cdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcblxuXHRcdFx0fSBlbHNlIHtcblxuXHRcdFx0XHQkaHR0cC5nZXQoIEVORFBPSU5UX1VSSSArICdhdXRoJywgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcblx0XHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cblx0XHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnYXV0aC5hdXRob3JpemUoKTonLCByZXMsIHJlcy5kYXRhICk7XG5cdFx0XHRcdFx0XHRpZGVudGl0eSA9IHJlcy5kYXRhO1xuXHRcdFx0XHRcdFx0X2lkZW50aXR5UmVzb2x2ZWQgPSB0cnVlO1xuXHRcdFx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggdHJ1ZSApO1xuXG5cdFx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cblx0XHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdhdXRob3JpemUnLCBlcnIsIGVyci5kYXRhICk7XG5cdFx0XHRcdFx0XHQvLyB0b2RvIGlmIGp3dCBleHBpcmVkICwgZGVhdXRob3JpemUsIHJlbW92ZSBsb2NhbCBzdG9yYWdlLCByZWRpcmVjdFxuXHRcdFx0XHRcdFx0X2lkZW50aXR5UmVzb2x2ZWQgPSB0cnVlO1xuXHRcdFx0XHRcdFx0ZGVmZXJyZWQucmVqZWN0KCBlcnIgKTtcblxuXHRcdFx0XHRcdH0gKTtcblxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcblxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGRlYXV0aG9yaXplKCkge1xuXHRcdFx0YXV0aFRva2VuLnJlbW92ZVRva2VuKCk7XG5cdFx0XHRpZGVudGl0eSA9IG51bGw7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gaXNBdXRoZW50aWNhdGVkKCkge1xuXHRcdFx0cmV0dXJuIGlkZW50aXR5ICE9PSBudWxsO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGlkZW50aXR5UmVzb2x2ZWQoKSB7XG5cdFx0XHRyZXR1cm4gX2lkZW50aXR5UmVzb2x2ZWQ7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblxuXHRcdFx0YXV0aG9yaXplLFxuXHRcdFx0ZGVhdXRob3JpemUsXG5cdFx0XHRpc0F1dGhlbnRpY2F0ZWQsXG5cdFx0XHRpZGVudGl0eVJlc29sdmVkXG5cblx0XHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2F1dGhUb2tlbicsIGZ1bmN0aW9uICggYXV0aFRva2VuICkge1xuXG5cdGZ1bmN0aW9uIHJlcXVlc3QoIGNvbmZpZyApIHtcblxuXHRcdGlmICggY29uZmlnLnJlcXVpcmVBdXRoICkge1xuXHRcdFx0dmFyIHRva2VuID0gYXV0aFRva2VuLmdldFRva2VuKCk7XG5cdFx0XHRpZiAoIHRva2VuICkge1xuXHRcdFx0XHQvLyBodHRwOi8vc2VsZi1pc3N1ZWQuaW5mby9kb2NzL2RyYWZ0LWlldGYtb2F1dGgtdjItYmVhcmVyLmh0bWwgICBzZWN0aW9uIDIuMVxuXHRcdFx0XHQvLyBodHRwczovL2RldmVsb3BlcnMuZ29vZ2xlLmNvbS9nbWFpbC9tYXJrdXAvYWN0aW9ucy92ZXJpZnlpbmctYmVhcmVyLXRva2Vuc1xuXHRcdFx0XHQvLyBodHRwOi8vd3d3LnczLm9yZy9Qcm90b2NvbHMvcmZjMjYxNi9yZmMyNjE2LXNlYzQuaHRtbCBzZWN0aW9uIDQuMiBoZWFkZXIgZmllbGQgbmFtZSBjYXNlIGluc2Vuc2l0aXZlXG5cdFx0XHRcdGNvbmZpZy5oZWFkZXJzLkF1dGhvcml6YXRpb24gPSAnQmVhcmVyICcgKyB0b2tlbjtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gY29uZmlnO1xuXG5cdH1cblxuXHRmdW5jdGlvbiByZXNwb25zZSggcmVzICkge1xuXHRcdHJldHVybiByZXM7XG5cdH1cblxuXHRyZXR1cm4ge1xuXG5cdFx0cmVxdWVzdCxcblx0XHRyZXNwb25zZVxuXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyR3aW5kb3cnLCBmdW5jdGlvbiAoIGxvZywgJHdpbmRvdyApIHtcblxuXHR2YXIgc3RvcmFnZSA9ICR3aW5kb3cubG9jYWxTdG9yYWdlO1xuXHR2YXIgY2FjaGVkVG9rZW4gPSBudWxsO1xuXG5cdGZ1bmN0aW9uIHNldFRva2VuKCB0b2tlbiApIHtcblx0XHRjYWNoZWRUb2tlbiA9IHRva2VuO1xuXHRcdHN0b3JhZ2Uuc2V0SXRlbSggJ2p3dCcsIHRva2VuICk7XG5cdH1cblxuXHRmdW5jdGlvbiBnZXRUb2tlbigpIHtcblx0XHRpZiAoICFjYWNoZWRUb2tlbiApIHtcblx0XHRcdGNhY2hlZFRva2VuID0gc3RvcmFnZS5nZXRJdGVtKCAnand0JyApO1xuXHRcdH1cblx0XHRyZXR1cm4gY2FjaGVkVG9rZW47XG5cdH1cblxuXHRmdW5jdGlvbiByZW1vdmVUb2tlbigpIHtcblx0XHRjYWNoZWRUb2tlbiA9IG51bGw7XG5cdFx0c3RvcmFnZS5yZW1vdmVJdGVtKCAnand0JyApO1xuXHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAndG9rZW4gcmVtb3ZlZCcgKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGhhc1Rva2VuKCkge1xuXHRcdHJldHVybiAhIWdldFRva2VuKCk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXG5cdFx0c2V0VG9rZW4sXG5cdFx0Z2V0VG9rZW4sXG5cdFx0cmVtb3ZlVG9rZW4sXG5cdFx0aGFzVG9rZW5cblxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnJGh0dHAnLCAnRU5EUE9JTlRfVVJJJywgJ2F1dGhUb2tlbicsICckc3RhdGUnLFxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgJGh0dHAsIEVORFBPSU5UX1VSSSwgYXV0aFRva2VuLCAkc3RhdGUgKSAge1xuXG5cdHZhciB2bSA9IHRoaXM7XG5cdHZtLnVzZXIgPSB7XG5cdFx0ZW1haWw6ICcnLFxuXHRcdHBhc3N3b3JkOiAnJ1xuXHR9O1xuXG5cdHZtLnNpZ25pbiA9IGZ1bmN0aW9uKCkge1xuXG5cdFx0aWYgKCB2bS51c2VyLmVtYWlsID09PSAnJyB8fCB2bS51c2VyLnBhc3N3b3JkID09PSAnJyApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnZW1haWwgJiBwYXNzd29yZCByZXF1aXJlZC4nICk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ25pbicsIHZtLnVzZXIgKVxuXHRcdFx0LnRoZW4oIGZ1bmN0aW9uKCByZXMgKSB7XG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnc2lnbmluJywgcmVzLCByZXMuZGF0YSApO1xuXHRcdFx0XHRhdXRoVG9rZW4uc2V0VG9rZW4oIHJlcy5kYXRhLnRva2VuICk7XG5cdFx0XHRcdCRzdGF0ZS5nbyggJ2NvbGxlY3Rpb24nICk7XG5cdFx0XHR9LCBmdW5jdGlvbiggZXJyLCBzdGF0dXMgKSB7XG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzaWduaW4nLCBlcnIgKTtcblx0XHRcdH0gKTtcblxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZScsICdhdXRoJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggJHN0YXRlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSAge1xuXG5cdGF1dGguZGVhdXRob3JpemUoKTtcblx0bW92aWVDb2xsZWN0aW9uLl9jbGVhcigpO1xuXHQkc3RhdGUuZ28oICdzaWduaW4nICk7XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICckaHR0cCcsICdFTkRQT0lOVF9VUkknLCAnYXV0aFRva2VuJywgJyRzdGF0ZScsXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApIHtcblxuXHRcdHZhciB2bSA9IHRoaXM7XG5cdFx0dm0udXNlciA9IHt9O1xuXG5cdFx0dm0uc2lnbnVwID0gZnVuY3Rpb24gKCkge1xuXG5cdFx0XHRpZiAoIHZtLnVzZXIuZW1haWwgPT09IHVuZGVmaW5lZCB8fCB2bS51c2VyLnBhc3N3b3JkID09PSB1bmRlZmluZWQgKSB7XG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCAnZW1haWwgJiBwYXNzd29yZCByZXF1aXJlZC4nICk7XG5cdFx0XHRcdHJldHVybjtcblx0XHRcdH1cblxuXHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdzaWduaW5nIHVwLi4uJyApO1xuXHRcdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ251cCcsIHZtLnVzZXIgKVxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cblx0XHRcdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ1JlZ2lzdGVyZWQuJywgcmVzICk7XG5cblx0XHRcdFx0XHRhdXRoVG9rZW4uc2V0VG9rZW4oIHJlcy5kYXRhLnRva2VuICk7XG5cdFx0XHRcdFx0JHN0YXRlLmdvKCAnY29sbGVjdGlvbicgKTtcblxuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsIGVyciApO1xuXHRcdFx0XHRcdHZtLmZvcm0uJHN1Ym1pdHRlZCA9IGZhbHNlO1xuXG5cdFx0XHRcdH0gKTtcblxuXHRcdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHJvb3RTY29wZScsIGZ1bmN0aW9uICggJHJvb3RTY29wZSApIHtcblxuXHR2YXIgRVZUID0ge1xuXG5cdFx0RU9QOiB7XG5cdFx0XHRsaXN0ZW46IGZ1bmN0aW9uICggY2IgKSB7ICRyb290U2NvcGUuJG9uKCAnRU9QJywgY2IgKTsgfSxcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnRU9QJyApOyB9XG5cdFx0fSxcblx0XHRjb2xsZWN0aW9uTW9kYWxPcGVuOiB7XG5cdFx0XHRsaXN0ZW46IGZ1bmN0aW9uICggY2IgKSB7ICRyb290U2NvcGUuJG9uKCAnY29sbGVjdGlvbk1vZGFsT3BlbicsIGNiICk7IH0sXG5cdFx0XHRlbWl0OiBmdW5jdGlvbiAoKSB7ICRyb290U2NvcGUuJGJyb2FkY2FzdCggJ2NvbGxlY3Rpb25Nb2RhbE9wZW4nICk7IH1cblx0XHR9LFxuXHRcdGNvbGxlY3Rpb25Nb2RhbENsb3NlOiB7XG5cdFx0XHRsaXN0ZW46IGZ1bmN0aW9uICggY2IgKSB7ICRyb290U2NvcGUuJG9uKCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnLCBjYiApOyB9LFxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdjb2xsZWN0aW9uTW9kYWxDbG9zZScgKTsgfVxuXHRcdH1cblxuXHR9O1xuXG5cdHJldHVybiBFVlQ7XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyBmdW5jdGlvbiAoKSB7XG5cblx0dmFyIGRlYnVnRW5hYmxlZCA9IGZhbHNlO1xuXHR2YXIgZGVidWdOYW1lc3BhY2VzID0gW107XG5cblx0dGhpcy5lbmFibGVEZWJ1ZyA9IGZ1bmN0aW9uICgpIHtcblx0XHRkZWJ1Z0VuYWJsZWQgPSB0cnVlO1xuXHR9O1xuXG5cdHRoaXMuZW5hYmxlRGVidWdOYW1lc3BhY2UgPSBmdW5jdGlvbiAoKSB7XG5cdFx0Zm9yICggbGV0IGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrICkge1xuXHRcdFx0ZGVidWdOYW1lc3BhY2VzLnB1c2goIGFyZ3VtZW50c1sgaSBdICk7XG5cdFx0fVxuXHR9O1xuXG5cdHRoaXMuJGdldCA9ICgpID0+IHtcblxuXHRcdGZ1bmN0aW9uIGRlYnVnKCkge1xuXHRcdFx0aWYgKCAhZGVidWdFbmFibGVkICkgcmV0dXJuO1xuXHRcdFx0dmFyIGRlYnVnTmFtZSA9IGFyZ3VtZW50c1sgMCBdO1xuXHRcdFx0dmFyIHNsaWNlZEFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCggYXJndW1lbnRzLCAxICk7XG5cdFx0XHRpZiAoIGRlYnVnTmFtZSA9PT0gJ2VycicgKSB7XG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IuYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ2luZm8nICkge1xuXHRcdFx0XHRjb25zb2xlLmluZm8uYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ3dhcm4nICkge1xuXHRcdFx0XHRjb25zb2xlLndhcm4uYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZXNwYWNlcy5pbmRleE9mKCBkZWJ1Z05hbWUgKSAhPT0gLTEgKSB7XG5cdFx0XHRcdGNvbnNvbGUubG9nLmFwcGx5KCBjb25zb2xlLCBbIGRlYnVnTmFtZSBdLmNvbmNhdCggc2xpY2VkQXJncyApICk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblx0XHRcdGRlYnVnXG5cdFx0fTtcblxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xuXG5cdGZ1bmN0aW9uIGRlYm91bmNlKCBmdW5jLCB3YWl0LCBpbW1lZGlhdGUgKSB7XG5cdFx0dmFyIF90aGlzID0gdGhpcyxcblx0XHRcdF9hcmd1bWVudHMgPSBhcmd1bWVudHM7XG5cblx0XHR2YXIgdGltZW91dDtcblx0XHRyZXR1cm4gZnVuY3Rpb24gKCkge1xuXG5cdFx0XHR2YXIgY29udGV4dCA9IF90aGlzLFxuXHRcdFx0XHRhcmdzID0gX2FyZ3VtZW50cztcblx0XHRcdHZhciBsYXRlciA9IGZ1bmN0aW9uIGxhdGVyKCkge1xuXG5cdFx0XHRcdHRpbWVvdXQgPSBudWxsO1xuXHRcdFx0XHRpZiAoICFpbW1lZGlhdGUgKSBmdW5jLmFwcGx5KCBjb250ZXh0LCBhcmdzICk7XG5cdFx0XHR9O1xuXHRcdFx0dmFyIGNhbGxOb3cgPSBpbW1lZGlhdGUgJiYgIXRpbWVvdXQ7XG5cdFx0XHRjbGVhclRpbWVvdXQoIHRpbWVvdXQgKTtcblx0XHRcdHRpbWVvdXQgPSBzZXRUaW1lb3V0KCBsYXRlciwgd2FpdCApO1xuXHRcdFx0aWYgKCBjYWxsTm93ICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xuXHRcdH07XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdGRlYm91bmNlXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJGh0dHBQcm92aWRlcicsIGZ1bmN0aW9uICggJGh0dHBQcm92aWRlciApIHtcblx0JGh0dHBQcm92aWRlci5pbnRlcmNlcHRvcnMucHVzaCggJ2F1dGhJbnRlcmNlcHRvcicgKTtcbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nUHJvdmlkZXInLCAnJGh0dHBQcm92aWRlcicsIGZ1bmN0aW9uICggbG9nUHJvdmlkZXIsICRodHRwUHJvdmlkZXIgKSB7XG5cblx0bG9nUHJvdmlkZXIuZW5hYmxlRGVidWcoKTtcblx0Ly8gbG9nUHJvdmlkZXIuZW5hYmxlRGVidWdOYW1lc3BhY2UoICdpbmZvJywgJ2VycicsICdhdXRoJywgJ2FwaScsICdjb2xsZWN0aW9uJyApO1xuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1Z05hbWVzcGFjZSggJ2luZm8nLCAnZXJyJyApO1xuXG5cdCRodHRwUHJvdmlkZXIudXNlTGVnYWN5UHJvbWlzZUV4dGVuc2lvbnMoIGZhbHNlICk7XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlUHJvdmlkZXInLCAnJHVybFJvdXRlclByb3ZpZGVyJywgJyRodHRwUHJvdmlkZXInLFxuZnVuY3Rpb24gKCAkc3RhdGVQcm92aWRlciwgJHVybFJvdXRlclByb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xuXG5cdCR1cmxSb3V0ZXJQcm92aWRlci5vdGhlcndpc2UoICcvJyApO1xuXG5cdCRzdGF0ZVByb3ZpZGVyXG5cdFx0LnN0YXRlKCAnaGVsaXgnLCB7XG5cdFx0XHR1cmw6ICcvJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9oZWxpeC5odG1sJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ3NpZ251cCcsIHtcblx0XHRcdHVybDogJy9zaWdudXAnLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL3NpZ251cC5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWdudXBDdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ3NpZ251cCdcblx0XHR9IClcblx0XHQuc3RhdGUoICdzaWduaW4nLCB7XG5cdFx0XHR1cmw6ICcvc2lnbmluJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9zaWduaW4uaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbmluQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdzaWduaW4nXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnc2lnbm91dCcsIHtcblx0XHRcdHVybDogJy9zaWdub3V0Jyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWdub3V0Q3RybCdcblx0XHR9IClcblx0XHQuc3RhdGUoICdtb3ZpZURldGFpbCcsIHtcblx0XHRcdHVybDogJy9tb3ZpZS86bW92aWVJZCcsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvbW92aWVEZXRhaWwuaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnbW92aWVEZXRhaWxDdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ21kJyxcblx0XHRcdHJlc29sdmU6IHtcblx0XHRcdFx0bW92aWVJdGVtOiBbICckc3RhdGVQYXJhbXMnLCAnVE1EYicsIGZ1bmN0aW9uICggJHN0YXRlUGFyYW1zLCBUTURiICkge1xuXHRcdFx0XHRcdHJldHVybiBUTURiLnNlYXJjaEJ5SWQoICRzdGF0ZVBhcmFtcy5tb3ZpZUlkICk7XG5cdFx0XHRcdH0gXVxuXHRcdFx0fVxuXHRcdH0gKVxuXHRcdC5zdGF0ZSgnY29sbGVjdGlvbicsIHtcblx0XHRcdHVybDogJy9jb2xsZWN0aW9uJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9jb2xsZWN0aW9uLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ21vdmllQ29sbGVjdGlvbkN0cmwnLFxuXHRcdFx0Y29udHJvbGxlckFzOiAnbWMnLFxuXHRcdFx0cmVzb2x2ZToge1xuXHRcdFx0XHRhdXRob3JpemU6IFsgJ2F1dGgnLCBmdW5jdGlvbiAoIGF1dGggKSB7XG5cdFx0XHRcdFx0cmV0dXJuIGF1dGguYXV0aG9yaXplKCk7XG5cdFx0XHRcdH0gXSxcblx0XHRcdFx0cmVzb2x2ZWRDb2xsZWN0aW9uOiBbICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoIG1vdmllQ29sbGVjdGlvbiApIHtcblx0XHRcdFx0XHRyZXR1cm4gbW92aWVDb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk7XG5cdFx0XHRcdH0gXVxuXHRcdFx0fVxuXHRcdH0pXG5cdDtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckd2luZG93JywgJ0VOR0lORScsICd1dGlsJywgZnVuY3Rpb24gKCAkd2luZG93LCBFTkdJTkUsIHV0aWwgKSB7XG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcblxuXHRcdEVOR0lORS5hdHRhY2hSZW5kZXJlciggJGVsZW1lbnQgKTtcblx0XHQkKCAkd2luZG93ICkub24oICdyZXNpemUnLCB1dGlsLmRlYm91bmNlKCBFTkdJTkUub25XaW5kb3dSZXNpemUsIDEwMCApICk7XG5cdFx0JGVsZW1lbnQub24oICd3aGVlbCcsIGZ1bmN0aW9uICggZXZ0ICkge1xuXHRcdFx0RU5HSU5FLiQkLndoZWVsX2R5ID0gLU1hdGguc2lnbiggZXZ0Lm9yaWdpbmFsRXZlbnQuZGVsdGFZICk7XG5cdFx0fSApO1xuXG5cdFx0RU5HSU5FLnN0YXJ0KCk7XG5cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRyZXBsYWNlOiB0cnVlLFxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXG5cdFx0dGVtcGxhdGU6ICc8ZGl2IGlkPVwiY2FudmFzLWNvbnRhaW5lclwiPjwvZGl2Pidcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckd2luZG93JywgZnVuY3Rpb24gKCAkd2luZG93ICkge1xuXG5cdHZhciAkJCA9IHtcblx0XHRjYW52YXM6IG51bGwsXG5cdFx0c3RhdHM6IG5ldyBTdGF0cygpLFxuXHRcdHNjZW5lOiBuZXcgVEhSRUUuU2NlbmUoKSxcblx0XHR3aWR0aDogJCh3aW5kb3cpLndpZHRoKCksXG5cdFx0aGVpZ2h0OiAkKHdpbmRvdykuaGVpZ2h0KCksXG5cdFx0Y2FtZXJhOiBuZXcgVEhSRUUuUGVyc3BlY3RpdmVDYW1lcmEoIDcwLCB0aGlzLndpZHRoIC8gdGhpcy5oZWlnaHQsIDEwLCAxMDAwMDAgKSxcblx0XHRyZW5kZXJlcjogbmV3IFRIUkVFLkNTUzNEUmVuZGVyZXIoKSxcblx0XHRzY3JlZW5fcmF0aW86IHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCxcblx0XHRwaXhlbF9yYXRpbzogJHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDEsXG5cdFx0bW91c2VfeDogdGhpcy53aWR0aCAqIDAuNSxcblx0XHRtb3VzZV95OiB0aGlzLmhlaWdodCAqIDAuNSxcblx0XHR3aGVlbF9keTogMFxuXHR9O1xuXG5cdCQkLnJlbmRlcmVyLnNldFNpemUoICQkLndpZHRoLCAkJC5oZWlnaHQgKTtcblxuXHRmdW5jdGlvbiBhdHRhY2hSZW5kZXJlciggY2FudmFzICkge1xuXHRcdCQkLmNhbnZhcyA9IGNhbnZhcztcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5yZW5kZXJlci5kb21FbGVtZW50ICk7XG5cdFx0Y2FudmFzLmFwcGVuZCggJCQuc3RhdHMuZG9tRWxlbWVudCApO1xuXHR9XG5cblx0ZnVuY3Rpb24gb25XaW5kb3dSZXNpemUoKSB7XG5cdFx0JCQud2lkdGggPSAkKHdpbmRvdykud2lkdGgoKTtcblx0XHQkJC5oZWlnaHQgPSAkKHdpbmRvdykuaGVpZ2h0KCk7XG5cdFx0JCQucGl4ZWxfcmF0aW8gPSAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMTtcblx0XHQkJC5zY3JlZW5fcmF0aW8gPSAkJC53aWR0aCAvICQkLmhlaWdodDtcblx0XHQkJC5jYW1lcmEuYXNwZWN0ID0gJCQuc2NyZWVuX3JhdGlvO1xuXHRcdCQkLmNhbWVyYS51cGRhdGVQcm9qZWN0aW9uTWF0cml4KCk7XG5cdFx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xuXHR9XG5cblx0ZnVuY3Rpb24gc2V0dXAoKSB7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHVwZGF0ZSgpIHtcblxuXHRcdGlmICggTWF0aC5hYnMoICQkLndoZWVsX2R5ICkgPiAwLjAwMSApIHtcblx0XHRcdCQkLmNhbWVyYS5wb3NpdGlvbi55ICs9ICQkLndoZWVsX2R5ICogMS4wO1xuXHRcdFx0JCQuY2FtZXJhLnJvdGF0ZVkoICQkLndoZWVsX2R5ICogMC4wMjUgKTtcblx0XHRcdCQkLndoZWVsX2R5ICo9IDAuOTU7XG5cdFx0fVxuXG5cdH1cblxuXHQvLyAtLS0tICBkcmF3IGxvb3Bcblx0ZnVuY3Rpb24gcnVuKCkge1xuXG5cdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKCBydW4gKTtcblx0XHR1cGRhdGUoKTtcblx0XHQkJC5yZW5kZXJlci5yZW5kZXIoICQkLnNjZW5lLCAkJC5jYW1lcmEgKTtcblx0XHQkJC5zdGF0cy51cGRhdGUoKTtcblxuXHR9XG5cblx0ZnVuY3Rpb24gc3RhcnQoKSB7XG5cdFx0c2V0dXAoKTtcblx0XHRydW4oKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlc2V0Q2FtZXJhKCkge1xuXHRcdCQkLmNhbWVyYS5wb3NpdGlvbi5zZXQoIDAsIDAsIDAgKTtcblx0XHQkJC5jYW1lcmEucm90YXRpb24uc2V0KCAwLCAwLCAwICk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdCQkLFxuXHRcdGF0dGFjaFJlbmRlcmVyLFxuXHRcdG9uV2luZG93UmVzaXplLFxuXHRcdHN0YXJ0LFxuXHRcdHJlc2V0Q2FtZXJhLFxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkdJTkUnLCAnJGNvbXBpbGUnLCAnJHJvb3RTY29wZScsXG5mdW5jdGlvbiAoIGxvZywgRU5HSU5FLCAkY29tcGlsZSwgJHJvb3RTY29wZSApIHtcblxuXHR2YXIgYWxsUG9zdGVycyA9IG5ldyBUSFJFRS5PYmplY3QzRCgpO1xuXHRFTkdJTkUuJCQuc2NlbmUuYWRkKCBhbGxQb3N0ZXJzICk7XG5cblx0ZnVuY3Rpb24gbWFrZUhlbGl4UG9zdGVycyggcG9zdGVyT2JqZWN0TXVsdGksIG9mZnNldFN0YXJ0SWR4ICkge1xuXG5cdFx0dmFyIHZlY3RvciA9IG5ldyBUSFJFRS5WZWN0b3IzKCk7XG5cdFx0dmFyIHJhZGl1cyA9IDkwMDtcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBwb3N0ZXJPYmplY3RNdWx0aS5sZW5ndGg7IGkrKyApIHtcblxuXHRcdFx0dmFyICRpc29sYXRlZFNjb3BlID0gJHJvb3RTY29wZS4kbmV3KCB0cnVlICk7XG5cdFx0XHQkaXNvbGF0ZWRTY29wZS5tb3ZpZUl0ZW0gPSBwb3N0ZXJPYmplY3RNdWx0aVsgaSBdO1xuXG5cdFx0XHR2YXIgcG9zdGVyRGlyZWN0aXZlRWxlbSA9ICRjb21waWxlKCAnPHBvc3Rlcj48L3Bvc3Rlcj4nICkoICRpc29sYXRlZFNjb3BlIClbIDAgXTtcblx0XHRcdHZhciBjc3MzZE9iaiA9IG5ldyBUSFJFRS5DU1MzRE9iamVjdCggcG9zdGVyRGlyZWN0aXZlRWxlbSApO1xuXG5cdFx0XHQvLyB0YWcgYWxvZyBhbiBpc29sYXRlZFNjb3BlIHRvIGJlIGRlc3Ryb3kgd2hlbiBkaXNwb3NlIGFuIGVsZW1lbnRcblx0XHRcdGNzczNkT2JqLnNjb3BlID0gJGlzb2xhdGVkU2NvcGU7XG5cblx0XHRcdHZhciBoaWR4ID0gaSArIG9mZnNldFN0YXJ0SWR4O1xuXHRcdFx0dmFyIHBoaSA9IGhpZHggKiAwLjE3NSArIE1hdGguUEk7XG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi54ID0gLSByYWRpdXMgKiBNYXRoLnNpbiggcGhpICk7XG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi55ID0gLSAoIGhpZHggKiA4ICkgKyAyMDA7XG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi56ID0gcmFkaXVzICogTWF0aC5jb3MoIHBoaSApO1xuXG5cdFx0XHR2ZWN0b3Iuc2V0KCAtY3NzM2RPYmoucG9zaXRpb24ueCAqIDIsIGNzczNkT2JqLnBvc2l0aW9uLnksIC1jc3MzZE9iai5wb3NpdGlvbi56ICogMiApO1xuXG5cdFx0XHRjc3MzZE9iai5sb29rQXQoIHZlY3RvciApO1xuXHRcdFx0YWxsUG9zdGVycy5hZGQoIGNzczNkT2JqICk7XG5cblx0XHR9XG5cblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2N1cnIgcG9zdGVyczonLCBhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCApO1xuXG5cdH1cblxuXHRmdW5jdGlvbiBjbGVhckFsbCgpIHtcblx0XHRhbGxQb3N0ZXJzLmNoaWxkcmVuLmZvckVhY2goIGZ1bmN0aW9uICggcG9zdGVyICkge1xuXHRcdFx0cG9zdGVyLmRpc3Bvc2VFbGVtZW50KCk7XG5cdFx0XHRwb3N0ZXIuc2NvcGUuJGRlc3Ryb3koKTtcblx0XHR9ICk7XG5cdFx0YWxsUG9zdGVycy5jaGlsZHJlbi5sZW5ndGggPSAwOyAvLyBjbGVhciBpdGVtc1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRtYWtlSGVsaXhQb3N0ZXJzLFxuXHRcdGNsZWFyQWxsXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlJywgJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCBmdW5jdGlvbiAoICRzdGF0ZSwgY29sbGVjdGlvbk1vZGFsU2VydmljZSApIHtcblxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRlbGVtZW50ICkge1xuXG5cdFx0Ly8gJHNjb3BlLm1vdmllSXRlbSBvYmogaXMgcGFzc2VkIHRocnUgaXNvbGF0ZWRTY29wZSB2aWEgY29tcGlsZWQgZGlyZWN0aXZlIGluIGhlbGl4LmZhYy5qc1xuXHRcdHZhciBpbWcgPSBuZXcgSW1hZ2UoKTtcblx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3AvdzE1NC8nICsgJHNjb3BlLm1vdmllSXRlbS5wb3N0ZXJfcGF0aDtcblx0XHRpbWcub25sb2FkID0gZnVuY3Rpb24gKCkge1xuXG5cdFx0XHQvLyB0b2RvIG1vdmUgY3NzIGludG8gc2FzcywgdXNlIGNsYXNzIGluc3RlYWRcblx0XHRcdCRlbGVtZW50LmNzcygge1xuXHRcdFx0XHQnd2lkdGgnOiAnMTUwcHgnLFxuXHRcdFx0XHQnaGVpZ2h0JzogJzIzMHB4Jyxcblx0XHRcdFx0J2JhY2tncm91bmQtcmVwZWF0JzogJ25vLXJlcGVhdCcsXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXNpemUnOiAnMTUwcHggMjMwcHgnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJyxcblx0XHRcdFx0J2Rpc3BsYXknOiAnbm9uZScgLy8gcmVxdWlyZWQgZm9yIGZhZGVJbiBhbmltYXRpb25cblx0XHRcdH0gKTtcblx0XHRcdCRlbGVtZW50LmZhZGVJbiggMTUwMCApO1xuXG5cdFx0fTtcblx0XHRpbWcuc3JjID0gaW1nVXJsO1xuXG5cdFx0JGVsZW1lbnQub24oICdjbGljaycsIGZ1bmN0aW9uICggZXZ0ICkge1xuXHRcdFx0JHN0YXRlLmdvKCAnbW92aWVEZXRhaWwnLCB7IG1vdmllSWQ6ICRzY29wZS5tb3ZpZUl0ZW0uaWQgfSApO1xuXHRcdFx0Y29sbGVjdGlvbk1vZGFsU2VydmljZS5zZXRBY3RpdmVJdGVtKCAkc2NvcGUubW92aWVJdGVtICk7XG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBjbGFzcz1cInBvc3RlckVsZW1cIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcbiIsImFuZ3VsYXIubW9kdWxlKCAnYXBwJywgW1xuXHQndWkucm91dGVyJyxcblx0J25nQW5pbWF0ZSdcbl0gKVxuLmNvbnN0YW50KCAnRU5EUE9JTlRfVVJJJywgJ2h0dHA6Ly9sb2NhbGhvc3Q6ODAwMS8nIClcbi5jb25zdGFudCggJ1RNREJfQVBJJywge1xuXHRrZXk6ICczNzRjMDM0MmE2NDA2ZGZlMGFlYjNkZTJlYTA0MmM1OScsXG5cdHVybDogJ2h0dHA6Ly9hcGkudGhlbW92aWVkYi5vcmcvMy8nXG59IClcblxuLnByb3ZpZGVyKCAnbG9nJywgcmVxdWlyZSggJy4vY29tbW9uL2xvZy5wdi5qcycgKSApXG4uZmFjdG9yeSggJ3V0aWwnLCByZXF1aXJlKCAnLi9jb21tb24vdXRpbC5qcycgKSApXG4uZmFjdG9yeSggJ0VWVCcsIHJlcXVpcmUoICcuL2NvbW1vbi9ldmVudHMuZmFjLmpzJyApIClcblxuLmZhY3RvcnkoICdUTURiJywgcmVxdWlyZSggJy4vQVBJL1RNRGIuZmFjLmpzJyApIClcblxuLmNvbnRyb2xsZXIoICdtYWluQ3RybCcsIHJlcXVpcmUoICcuL21haW4uY3RybC5qcycgKSApXG4uZmFjdG9yeSggJ0VOR0lORScsIHJlcXVpcmUoICcuL2hlbGl4L2VuZ2luZS5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdoZWxpeCcsIHJlcXVpcmUoICcuL2hlbGl4L2hlbGl4LmZhYy5qcycgKSApXG4uZGlyZWN0aXZlKCAnZGlzcGxheScsIHJlcXVpcmUoICcuL2hlbGl4L2Rpc3BsYXkuZGlyLmpzJyApIClcbi5kaXJlY3RpdmUoICdwb3N0ZXInLCByZXF1aXJlKCAnLi9oZWxpeC9wb3N0ZXIuZGlyLmpzJyApIClcblxuLmNvbnRyb2xsZXIoICdtb3ZpZURldGFpbEN0cmwnLCByZXF1aXJlKCAnLi9tb3ZpZURldGFpbC5jdHJsLmpzJyApIClcblxuLmZhY3RvcnkoICdhdXRoJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2F1dGhUb2tlbicsIHJlcXVpcmUoICcuL2F1dGgvYXV0aFRva2VuLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2F1dGhJbnRlcmNlcHRvcicsIHJlcXVpcmUoICcuL2F1dGgvYXV0aEludGVyY2VwdG9yLmZhYy5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ251cEN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ251cC5jdHJsLmpzJyApIClcbi5jb250cm9sbGVyKCAnc2lnbmluQ3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbmluLmN0cmwuanMnICkgKVxuLmNvbnRyb2xsZXIoICdzaWdub3V0Q3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbm91dC5jdHJsLmpzJyApIClcblxuLmNvbnRyb2xsZXIoICdtb3ZpZUNvbGxlY3Rpb25DdHJsJywgcmVxdWlyZSggJy4vbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzJyApIClcbi5mYWN0b3J5KCAnbW92aWVDb2xsZWN0aW9uJywgcmVxdWlyZSggJy4vbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlJywgcmVxdWlyZSggJy4vbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UuZmFjLmpzJyApIClcbi5kaXJlY3RpdmUoICdjb2xsZWN0aW9uTW9kYWwnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsLmRpci5qcycgKSApXG4uZGlyZWN0aXZlKCAnY29sbGVjdGlvbkl0ZW0nLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbkl0ZW0uZGlyLmpzJyApIClcblxuLmNvbmZpZyggcmVxdWlyZSggJy4vY29uZmlnL3JvdXRlQ29uZmlnLmpzJyApIClcbi5jb25maWcoIHJlcXVpcmUoICcuL2NvbmZpZy9sb2dDb25maWcuanMnICkgKVxuLmNvbmZpZyggcmVxdWlyZSggJy4vY29uZmlnL2h0dHBDb25maWcuanMnICkgKVxuLnJ1biggWyAnbG9nJywgJyRyb290U2NvcGUnLCAnJHN0YXRlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCBsb2csICRyb290U2NvcGUsICRzdGF0ZSwgYXV0aCwgbW92aWVDb2xsZWN0aW9uICkge1xuXG5cdGF1dGguYXV0aG9yaXplKCB0cnVlICk7XG5cblx0bW92aWVDb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk7XG5cblx0JHJvb3RTY29wZS4kb24oICckc3RhdGVDaGFuZ2VFcnJvcicsIGZ1bmN0aW9uICggZXZlbnQsIHRvU3RhdGUsIHRvUGFyYW1zLCBmcm9tU3RhdGUsIGZyb21QYXJhbXMsIGVycm9yICkge1xuXG5cdFx0ZXZlbnQucHJldmVudERlZmF1bHQoKTsgLy8gcHJldmVudCB0cmFuc2l0aW9uXG5cdFx0bG9nLmRlYnVnKCAnd2FybicsIGVycm9yICk7XG5cdFx0aWYgKCBlcnJvciApIHtcblx0XHRcdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcblx0XHR9XG5cblx0fSApO1xuXG59IF0gKVxuO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ1RNRGInLCAnRVZUJywgJ2hlbGl4JywgJ0VOR0lORScsICdhdXRoJywgJyRzdGF0ZScsXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCBUTURiLCBFVlQsIGhlbGl4LCBFTkdJTkUsIGF1dGgsICRzdGF0ZSApIHtcblxuXHR2YXIgdm0gPSB0aGlzO1xuXHR2bS5hdXRoID0gYXV0aDtcblx0dm0uc2VhcmNoID0ge1xuXHRcdHF1ZXJ5OiAnJyxcblx0fTtcblx0dm0ubW92aWVJdGVtcyA9IG51bGw7XG5cblx0JHNjb3BlLiR3YXRjaCggVE1EYi5nZXRSZXMsIGZ1bmN0aW9uICggbW92SXRlbXMsIG9sZE1vdkl0ZW1zICkge1xuXG5cdFx0dm0ubW92aWVJdGVtcyA9IG1vdkl0ZW1zO1xuXHRcdGhlbGl4Lm1ha2VIZWxpeFBvc3RlcnMoIG1vdkl0ZW1zLnNsaWNlKCBvbGRNb3ZJdGVtcy5sZW5ndGggKSwgb2xkTW92SXRlbXMubGVuZ3RoICk7XG5cblx0fSwgdHJ1ZSApO1xuXG5cdHZhciBwcmV2UXVlcnkgPSAnJztcblx0dm0uc2VhcmNoID0gZnVuY3Rpb24gKCkge1xuXHRcdGlmICggdm0uc2VhcmNoLnF1ZXJ5ID09PSAnJyApIHJldHVybjtcblx0XHRpZiAoIHByZXZRdWVyeSAhPT0gdm0uc2VhcmNoLnF1ZXJ5ICkge1xuXHRcdFx0cHJldlF1ZXJ5ID0gdm0uc2VhcmNoLnF1ZXJ5O1xuXHRcdFx0VE1EYi5jbGVhclNlYXJjaCgpO1xuXHRcdFx0aGVsaXguY2xlYXJBbGwoKTtcblx0XHRcdEVOR0lORS5yZXNldENhbWVyYSgpO1xuXHRcdH1cblx0XHRpZiAoICRzdGF0ZS5jdXJyZW50Lm5hbWUgIT09ICdoZWxpeCcgKSB7XG5cdFx0XHQkc3RhdGUuZ28oICdoZWxpeCcgKTtcblx0XHR9XG5cdFx0VE1EYi5zZWFyY2hCeVRpdGxlKCB2bS5zZWFyY2ggKTtcblx0fTtcblxuXHQvLyBERUJVR1xuXHR3aW5kb3cuU0NPUEUgPSAkc2NvcGU7XG5cdHZtLlRNRGIgPSBUTURiO1xuXHR2bS5oZWxpeCA9IGhlbGl4O1xuXHR2bS5FTkdJTkUgPSBFTkdJTkU7XG5cdHZtLlNUQVRFID0gJHN0YXRlO1xuXG5cdEVWVC5FT1AubGlzdGVuKCBmdW5jdGlvbiAoKSB7XG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICdyZWNpZXZlZCBFT1AgZXZlbnQhJyApO1xuXHR9ICk7XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ1RNRGInLCBmdW5jdGlvbiAoIGxvZywgVE1EYiApIHtcblxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRhdHRycywgJGVsZW1lbnQgKSB7XG5cblx0XHRUTURiLnNlYXJjaEJ5SWQoIHBhcnNlSW50KCAkc2NvcGUubW92aWVJZCApIClcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cblx0XHRcdC8vIGxvZy5kZWJ1ZyggJ2luZm8nLCAnY29sbGVjdGlvbkl0ZW1EaXJlY3RpdmUnLCByZXMgKTtcblx0XHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC93OTIvJyArIHJlcy5wb3N0ZXJfcGF0aDtcblx0XHRcdCRlbGVtZW50LmNzcygge1xuXHRcdFx0XHQnd2lkdGgnOiAnMTAwJScsXG5cdFx0XHRcdCdoZWlnaHQnOiAnMTAwJScsXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXJlcGVhdCc6ICduby1yZXBlYXQnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1zaXplJzogJzEwMCUgMTAwJScsXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknXG5cdFx0XHR9ICk7XG5cblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdjb2xsZWN0aW9uSXRlbURpcmVjdGl2ZScsIGVyciApO1xuXHRcdH0gKTtcblxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZXN0cmljdDogJ0UnLFxuXHRcdHJlcGxhY2U6IHRydWUsXG5cdFx0c2NvcGU6IHsgbW92aWVJZDogJ0AnIH0sXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHRjb250cm9sbGVyQXM6ICdjaScsXG5cdFx0dGVtcGxhdGU6ICc8ZGl2PjwvZGl2Pidcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnbW92aWVDb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCAnRVZUJyxcbmZ1bmN0aW9uICggbG9nLCBtb3ZpZUNvbGxlY3Rpb24sIGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UsIEVWVCApIHtcblxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRlbGVtZW50LCAkYXR0cnMgKSB7XG5cblx0XHR2YXIgdm0gPSB0aGlzO1xuXHRcdHZtLm1vdmllQ29sbGVjdGlvbiA9IG1vdmllQ29sbGVjdGlvbjtcblx0XHR2bS5jb2xsZWN0aW9uTW9kYWxTZXJ2aWNlID0gY29sbGVjdGlvbk1vZGFsU2VydmljZTtcblxuXHRcdHZtLmFkZGluZ05ld0NvbGxlY3Rpb24gPSBmYWxzZTtcblxuXHRcdHZtLm9wZW5FZGl0b3IgPSBmdW5jdGlvbiAoKSB7XG5cdFx0XHR2bS5hZGRpbmdOZXdDb2xsZWN0aW9uID0gdHJ1ZTtcblx0XHR9O1xuXG5cdFx0dm0uY2xvc2VFZGl0b3IgPSBmdW5jdGlvbiAoKSB7XG5cdFx0XHR2bS5hZGRpbmdOZXdDb2xsZWN0aW9uID0gZmFsc2U7XG5cdFx0fTtcblxuXHRcdHZtLmNyZWF0ZU5ld0NvbGxlY3Rpb24gPSBmdW5jdGlvbiAoKSB7XG5cdFx0XHRtb3ZpZUNvbGxlY3Rpb24uY3JlYXRlKCAkc2NvcGUubmV3Q29sbGVjdGlvbk5hbWUgKTtcblx0XHRcdHZtLmNsb3NlRWRpdG9yKCk7XG5cdFx0fTtcblxuXHRcdHZtLmFkZFRvQ29sbGVjdGlvbiA9IGZ1bmN0aW9uICggbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2FkZFRvQ29sbGVjdGlvbjonLCBtb3ZpZUlkLCBjb2xsZWN0aW9uTmFtZSApO1xuXHRcdFx0dmFyIHN1Y2Nlc3MgPSBtb3ZpZUNvbGxlY3Rpb24ucHVzaCggbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKTtcblx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnbW92aWVDb2xsZWN0aW9uLnB1c2gnLCBzdWNjZXNzICk7XG5cdFx0fTtcblxuXHRcdC8vIGRlZmF1bHQgY3NzIGF0IGRpcmVjdGl2ZSBpbml0aWFsaXphdGlvblxuXHRcdCRlbGVtZW50LmNzcyggeyB2aXNpYmlsaXR5OiAnaGlkZGVuJyB9ICk7XG5cblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsT3Blbi5saXN0ZW4oIGZ1bmN0aW9uICgpIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsT3BlbicgKTtcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ3Zpc2libGUnIH0gKTtcblx0XHR9ICk7XG5cblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UubGlzdGVuKCBmdW5jdGlvbiAoKSB7XG5cdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb25Nb2RhbENsb3NlJyApO1xuXHRcdCRlbGVtZW50LmNzcyggeyB2aXNpYmlsaXR5OiAnaGlkZGVuJyB9ICk7XG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRzY29wZToge30sXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHRjb250cm9sbGVyQXM6ICdtb2RhbCcsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvY29sbGVjdGlvbk1vZGFsLmh0bWwnXG5cblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRVZUJywgZnVuY3Rpb24gKCBsb2csIEVWVCApIHtcblxuXHR2YXIgYWN0aXZlSXRlbSA9IG51bGw7XG5cblx0ZnVuY3Rpb24gc2V0QWN0aXZlSXRlbSggaXRlbSApIHtcblx0XHRhY3RpdmVJdGVtID0gaXRlbTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdldEFjdGl2ZUl0ZW0oIGl0ZW0gKSB7XG5cdFx0cmV0dXJuIGFjdGl2ZUl0ZW07XG5cdH1cblxuXHRmdW5jdGlvbiBvcGVuKCkge1xuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxPcGVuLmVtaXQoKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGNsb3NlKCkge1xuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxDbG9zZS5lbWl0KCk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHNldEFjdGl2ZUl0ZW0sXG5cdFx0Z2V0QWN0aXZlSXRlbSxcblx0XHRvcGVuLFxuXHRcdGNsb3NlXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdhdXRoJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggbG9nLCAkc2NvcGUsIGF1dGgsIG1vdmllQ29sbGVjdGlvbiApICB7XG5cblx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdjb2xsZWN0aW9uQ3RybCcsIG1vdmllQ29sbGVjdGlvbi5nZXRDb2xsZWN0aW9uKCkgKTtcblx0dmFyIHZtID0gdGhpcztcblx0dm0ubW92aWVDb2xsZWN0aW9uID0gbW92aWVDb2xsZWN0aW9uO1xuXG5cdHZtLnZpZXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKCBjb2xsZWN0aW9uICkge1xuXHRcdGNvbnNvbGUubG9nKCBjb2xsZWN0aW9uICk7XG5cdFx0LyogY2FsbCBtb3ZpZUNvbGxlY3Rpb24uZmV0Y2hBbGwoKVxuXHRcdFx0Y2xlYXJIZWxpeCgpXG5cdFx0XHRjYWxsIG1ha2UgaGVsaXggdy8gZmV0Y2hlZCByZXN1bHRcblx0XHRcdHVpIHN0YXRlIC0+IGhlbGl4XG5cdFx0Ki9cblx0fTtcblxuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkRQT0lOVF9VUkknLCAnJGh0dHAnLCAnJHEnLCBmdW5jdGlvbiAoIGxvZywgRU5EUE9JTlRfVVJJLCAkaHR0cCwgJHEgKSB7XG5cblx0dmFyIERCX0VORFBPSU5UID0gRU5EUE9JTlRfVVJJICsgJ2NvbGxlY3Rpb24nO1xuXHR2YXIgY29sbGVjdGlvbiA9IG51bGw7XG5cblx0dmFyIGZ1bGxDb2xsZWN0aW9uID0gbnVsbDtcblxuXHRmdW5jdGlvbiBjcmVhdGUoIG5hbWUgKSB7XG5cdFx0Y29sbGVjdGlvbi5wdXNoKCB7IGNvbGxlY3Rpb25OYW1lOiBuYW1lLCBtb3ZpZXM6IFtdIH0gKTtcblx0XHRwdXQoKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGlzRW1wdHkoKSB7XG5cdFx0cmV0dXJuIGNvbGxlY3Rpb24ubGVuZ3RoID09PSAwO1xuXHR9XG5cblx0ZnVuY3Rpb24gZmV0Y2hBbGwoIGNvbGxlY3Rpb25OYW1lICkge1xuXG5cdH1cblxuXHRmdW5jdGlvbiByZXNvbHZlQ29sbGVjdGlvbigpIHtcblxuXHRcdHZhciBkZWZlcnJlZCA9ICRxLmRlZmVyKCk7XG5cblx0XHRpZiAoIGNvbGxlY3Rpb24gIT09IG51bGwgKSB7XG5cdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCBjb2xsZWN0aW9uICk7XG5cdFx0fSBlbHNlIHtcblx0XHRcdCRodHRwLmdldCggREJfRU5EUE9JTlQsIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXG5cdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblx0XHRcdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTonLCByZXMgKTtcblx0XHRcdFx0XHRpZiAoIHJlcy5kYXRhICkge1xuXHRcdFx0XHRcdFx0Y29sbGVjdGlvbiA9IHJlcy5kYXRhO1xuXHRcdFx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdFx0XHRjb2xsZWN0aW9uID0gW107XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2NvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTonLCBlcnIgKTtcblx0XHRcdFx0XHRkZWZlcnJlZC5yZWplY3QoIGVyciApO1xuXHRcdFx0XHR9ICk7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIGhhc0l0ZW0oIGl0ZW1JZCwgc29tZUNvbGxlY3Rpb24gKSB7XG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IHNvbWVDb2xsZWN0aW9uICkge1xuXHRcdFx0XHRmb3IgKCB2YXIgayA9IDA7IGsgPCBjb2xsZWN0aW9uW2ldLm1vdmllcy5sZW5ndGg7IGsgKysgKSB7XG5cdFx0XHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLm1vdmllc1trXSA9PT0gaXRlbUlkICkge1xuXHRcdFx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHRcdFx0fVxuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXG5cdGZ1bmN0aW9uIHB1dCgpIHtcblx0XHQkaHR0cC5wdXQoIERCX0VORFBPSU5ULCBjb2xsZWN0aW9uLCB7IHJlcXVpcmVBdXRoOiB0cnVlIH0gKVxuXHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb24ucHV0KCk6JywgcmVzICk7XG5cdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2NvbGxlY3Rpb24ucHV0KCk6JywgZXJyICk7XG5cdFx0XHR9ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBwdXNoKCBpdGVtSWQsIHRvQ29sbGVjdGlvbiApIHtcblx0XHRpZiAoIGhhc0l0ZW0oIGl0ZW1JZCwgdG9Db2xsZWN0aW9uICkgKSB7XG5cdFx0XHRyZXR1cm4gZmFsc2U7XG5cdFx0fVxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IGNvbGxlY3Rpb24ubGVuZ3RoOyBpICsrICkge1xuXHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLmNvbGxlY3Rpb25OYW1lID09PSB0b0NvbGxlY3Rpb24gKSB7XG5cdFx0XHRcdGNvbGxlY3Rpb25baV0ubW92aWVzLnB1c2goIGl0ZW1JZCApO1xuXHRcdFx0XHRwdXQoKTtcblx0XHRcdFx0cmV0dXJuIHRydWU7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZSggaXRlbUlkLCBpbkNvbGxlY3Rpb24gKSB7XG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IGluQ29sbGVjdGlvbiApIHtcblx0XHRcdFx0Zm9yICggdmFyIGsgPSAwOyBrIDwgY29sbGVjdGlvbltpXS5tb3ZpZXMubGVuZ3RoOyBrICsrICkge1xuXHRcdFx0XHRcdGlmICggY29sbGVjdGlvbltpXS5tb3ZpZXNba10gPT09IGl0ZW1JZCApIHtcblx0XHRcdFx0XHRcdHZhciByZW1vdmVkID0gY29sbGVjdGlvbltpXS5tb3ZpZXMuc3BsaWNlKCBrLCAxICkubGVuZ3RoO1xuXHRcdFx0XHRcdFx0cHV0KCk7XG5cdFx0XHRcdFx0XHRyZXR1cm4gcmVtb3ZlZCAhPT0gMDtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVtb3ZlQ29sbGVjdGlvbiggY29sbGVjdGlvbk5hbWUgKSB7XG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IGNvbGxlY3Rpb25OYW1lICkge1xuXHRcdFx0XHR2YXIgcmVtb3ZlZCA9IGNvbGxlY3Rpb24uc3BsaWNlKCBpLCAxICkubGVuZ3RoO1xuXHRcdFx0XHRwdXQoKTtcblx0XHRcdFx0cmV0dXJuIHJlbW92ZWQgIT09IDA7XG5cdFx0XHR9XG5cdFx0fVxuXHRcdHJldHVybiBmYWxzZTtcblx0fVxuXG5cdGZ1bmN0aW9uIHN5bmMoKSB7XG5cdFx0Ly8gc3luYyBsb2NhbCBjb2xlbGN0aW9uIHcvIERCXG5cdH1cblxuXHRmdW5jdGlvbiBnZXRDb2xsZWN0aW9uKCkge1xuXHRcdHJldHVybiBjb2xsZWN0aW9uO1xuXHR9XG5cblx0ZnVuY3Rpb24gX2NsZWFyKCkge1xuXHRcdGNvbGxlY3Rpb24gPSBudWxsO1xuXHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnbG9jYWwgY29sbGVjdGlvbiBjbGVhcmVkLicgKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0Z2V0Q29sbGVjdGlvbixcblx0XHRjcmVhdGUsXG5cdFx0cHVzaCxcblx0XHRwdXQsXG5cdFx0cmVtb3ZlLFxuXHRcdHJlbW92ZUNvbGxlY3Rpb24sXG5cdFx0c3luYyxcblx0XHRfY2xlYXIsXG5cdFx0cmVzb2x2ZUNvbGxlY3Rpb24sXG5cdFx0aGFzSXRlbSxcblx0XHRpc0VtcHR5XG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdUTURiJywgJyRjYWNoZUZhY3RvcnknLCAnbW92aWVJdGVtJywgJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCAnbW92aWVDb2xsZWN0aW9uJyxcbmZ1bmN0aW9uKCBsb2csICRzY29wZSwgVE1EYiwgJGNhY2hlRmFjdG9yeSwgbW92aWVJdGVtLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLCBtb3ZpZUNvbGxlY3Rpb24gKSB7XG5cblx0dmFyIHZtID0gdGhpcztcblx0dm0ubW92aWVJdGVtID0gbW92aWVJdGVtOyAvLyBtb3ZpZUl0ZW0gaW5qZWN0ZWQgdmlhIHN0YXRlIHJlc29sdmVcblx0bG9nLmRlYnVnKCAnY3RybCcsICdtb3ZpZURldGFpbCBjdHJsIHJlc29sdmVkOicsIHZtLm1vdmllSXRlbSApO1xuXG5cdG1vdmllSXRlbS5mdWxsVGl0bGUgPSBtb3ZpZUl0ZW0udGl0bGU7XG5cdGlmICggbW92aWVJdGVtLnRpdGxlICE9PSBtb3ZpZUl0ZW0ub3JpZ2luYWxfdGl0bGUgKSB7XG5cdFx0bW92aWVJdGVtLmZ1bGxUaXRsZSA9IG1vdmllSXRlbS50aXRsZSArICcgKCcgKyBtb3ZpZUl0ZW0ub3JpZ2luYWxfdGl0bGUgKyAnKSc7XG5cdH1cblxuXHRpZiAoIG1vdmllSXRlbS5iYWNrZHJvcF9wYXRoICkge1xuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC9vcmlnaW5hbCcgKyBtb3ZpZUl0ZW0uYmFja2Ryb3BfcGF0aDtcblx0XHQkKCAnLmJhY2tkcm9wJyApLmNzcygge1xuXHRcdFx0J2JhY2tncm91bmQtaW1hZ2UnOiAndXJsKCcgKyBpbWdVcmwgKyAnKSdcblx0XHR9ICk7XG5cdH1cblxuXHR2bS5vcGVuQ29sbGVjdGlvbk1vZGFsID0gZnVuY3Rpb24gKCkge1xuXHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2Uuc2V0QWN0aXZlSXRlbSggbW92aWVJdGVtICk7XG5cdFx0Y29sbGVjdGlvbk1vZGFsU2VydmljZS5vcGVuKCk7XG5cdH07XG5cbn0gXTtcbiJdfQ==
