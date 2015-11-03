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

		$http({
			method: 'GET',
			cache: true,
			url: TMDB_API.url + 'search/movie',
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
					console.log(item.id, item);
					movieIdCache.put(item.id, item);
					// putItemToDB( item );
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9BUEkvVE1EYi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGguZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9hdXRoVG9rZW4uZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9zaWduaW4uY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbm91dC5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvYXV0aC9zaWdudXAuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2NvbW1vbi9ldmVudHMuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvY29tbW9uL2xvZy5wdi5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2NvbW1vbi91dGlsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvY29uZmlnL2h0dHBDb25maWcuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9jb25maWcvbG9nQ29uZmlnLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvY29uZmlnL3JvdXRlQ29uZmlnLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvZGlzcGxheS5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9lbmdpbmUuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvaGVsaXguZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvcG9zdGVyLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2luZGV4LmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbWFpbi5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25JdGVtLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWwuZGlyLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9tb3ZpZURldGFpbC5jdHJsLmpzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQUFBOzs7QUNBQSxNQUFNLENBQUMsT0FBTyxHQUFHLENBQUUsS0FBSyxFQUFFLE9BQU8sRUFBRSxVQUFVLEVBQUUsS0FBSyxFQUFFLGVBQWUsRUFBRSxJQUFJLEVBQUUsY0FBYyxFQUMzRixVQUFXLEdBQUcsRUFBRSxLQUFLLEVBQUUsUUFBUSxFQUFFLEdBQUcsRUFBRSxhQUFhLEVBQUUsRUFBRSxFQUFFLFlBQVksRUFBRzs7QUFFdkUsS0FBSSxZQUFZLEdBQUcsRUFBRSxDQUFDO0FBQ3RCLEtBQUksYUFBYSxHQUFHLENBQUMsQ0FBQztBQUN0QixLQUFJLFVBQVUsR0FBRyxDQUFDLENBQUMsQ0FBQztBQUNwQixLQUFJLFFBQVEsR0FBRyxDQUFDLENBQUM7O0FBRWpCLEtBQUksWUFBWSxHQUFHLGFBQWEsQ0FBRSxjQUFjLENBQUUsQ0FBQzs7O0FBR25ELEtBQUksV0FBVyxHQUFHLFlBQVksR0FBRyxRQUFRLENBQUM7O0FBRTFDLFVBQVMsV0FBVyxDQUFFLFNBQVMsRUFBRzs7QUFFakMsT0FBSyxDQUFDLEdBQUcsQ0FBRSxXQUFXLEdBQUcsU0FBUyxDQUFDLEVBQUUsRUFBRSxTQUFTLENBQUUsQ0FDakQsSUFBSSxDQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ3ZCLE1BQUcsQ0FBQyxLQUFLLENBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxHQUFHLENBQUUsQ0FBQztHQUNoQyxFQUFFLFVBQVcsR0FBRyxFQUFHO0FBQ25CLE1BQUcsQ0FBQyxLQUFLLENBQUUsS0FBSyxFQUFFLE1BQU0sRUFBRSxHQUFHLENBQUUsQ0FBQztHQUNoQyxDQUFFLENBQUM7RUFDSjs7QUFFRCxVQUFTLGNBQWMsQ0FBRSxFQUFFLEVBQUc7QUFDN0IsTUFBSSxPQUFPLEdBQUcsS0FBSyxDQUFDLEdBQUcsQ0FBRSxXQUFXLEdBQUcsRUFBRSxDQUFFLENBQzFDLElBQUksQ0FBRSxVQUFXLEdBQUcsRUFBRztBQUN2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RztHQUN6QyxDQUFFLENBQUM7RUFDSjs7QUFFRCxHQUFFLENBQUMsbUJBQW1CLEdBQUcsWUFBWTtBQUNwQyx3QkFBc0IsQ0FBQyxhQUFhLENBQUUsU0FBUyxDQUFFLENBQUM7QUFDbEQsd0JBQXNCLENBQUMsSUFBSSxFQUFFLENBQUM7RUFDOUIsQ0FBQztDQUVGLENBQUUsQ0FBQyIsImZpbGUiOiJnZW5lcmF0ZWQuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlc0NvbnRlbnQiOlsiKGZ1bmN0aW9uIGUodCxuLHIpe2Z1bmN0aW9uIHMobyx1KXtpZighbltvXSl7aWYoIXRbb10pe3ZhciBhPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7aWYoIXUmJmEpcmV0dXJuIGEobywhMCk7aWYoaSlyZXR1cm4gaShvLCEwKTt2YXIgZj1uZXcgRXJyb3IoXCJDYW5ub3QgZmluZCBtb2R1bGUgJ1wiK28rXCInXCIpO3Rocm93IGYuY29kZT1cIk1PRFVMRV9OT1RfRk9VTkRcIixmfXZhciBsPW5bb109e2V4cG9ydHM6e319O3Rbb11bMF0uY2FsbChsLmV4cG9ydHMsZnVuY3Rpb24oZSl7dmFyIG49dFtvXVsxXVtlXTtyZXR1cm4gcyhuP246ZSl9LGwsbC5leHBvcnRzLGUsdCxuLHIpfXJldHVybiBuW29dLmV4cG9ydHN9dmFyIGk9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtmb3IodmFyIG89MDtvPHIubGVuZ3RoO28rKylzKHJbb10pO3JldHVybiBzfSkiLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckaHR0cCcsICdUTURCX0FQSScsICdFVlQnLCAnJGNhY2hlRmFjdG9yeScsICckcScsICdFTkRQT0lOVF9VUkknLFxyXG5mdW5jdGlvbiAoIGxvZywgJGh0dHAsIFRNREJfQVBJLCBFVlQsICRjYWNoZUZhY3RvcnksICRxLCBFTkRQT0lOVF9VUkkgKSB7XHJcblxyXG5cdHZhciBzZWFyY2hSZXN1bHQgPSBbXTtcclxuXHR2YXIgcHJldlJlc3VsdExlbiA9IDA7XHJcblx0dmFyIHRvdGFsUGFnZXMgPSAtMTtcclxuXHR2YXIgY3VyclBhZ2UgPSAxO1xyXG5cclxuXHR2YXIgbW92aWVJZENhY2hlID0gJGNhY2hlRmFjdG9yeSggJ21vdmllSWRDYWNoZScgKTtcclxuXHQvLyBUTURCX0FQSS51cmwgKyAnbW92aWUvbm93X3BsYXlpbmcnXHJcblxyXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdtb3ZpZS8nO1xyXG5cclxuXHRmdW5jdGlvbiBwdXRJdGVtVG9EQiggbW92aWVJdGVtICkge1xyXG5cdFx0Ly8gdG9kbyBkb250IHB1dCBleGlzaXRpbmcgaXRlbSBpbiBkYiAoIFVQU0VSVCApXHJcblx0XHQkaHR0cC5wdXQoIERCX0VORFBPSU5UICsgbW92aWVJdGVtLmlkLCBtb3ZpZUl0ZW0gKVxyXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnUFVUOicsIHJlcyApO1xyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdQVVQ6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hJZEZyb21EQiggaWQgKSB7XHJcblx0XHR2YXIgcHJvbWlzZSA9ICRodHRwLmdldCggREJfRU5EUE9JTlQgKyBpZCApXHJcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsICdzZWFyY2hCeUlkID0+IERCOicsIHJlcy5kYXRhICk7XHJcblx0XHRcdGlmICggcmVzLmRhdGEgKSB7XHJcblx0XHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XHJcblx0XHRcdFx0cmV0dXJuIHJlcy5kYXRhO1xyXG5cdFx0XHR9IGVsc2Uge1xyXG5cdFx0XHRcdHJldHVybiBudWxsO1xyXG5cdFx0XHR9XHJcblx0XHR9LCBmdW5jdGlvbiggZXJyICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBEQjonLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHRcdHJldHVybiBwcm9taXNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tQVBJKCBpZCApIHtcclxuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBUTURCX0FQSS51cmwgKyAnbW92aWUvJyArIGlkLCB7XHJcblx0XHRcdHBhcmFtczogeyBhcGlfa2V5OiBUTURCX0FQSS5rZXkgfVxyXG5cdFx0fSApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgcmVzLmRhdGEgKTtcclxuXHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XHJcblx0XHRcdHB1dEl0ZW1Ub0RCKCByZXMuZGF0YSApO1xyXG5cdFx0XHRyZXR1cm4gcmVzLmRhdGE7XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5SWQgPT4gQVBJOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cdFx0cmV0dXJuIHByb21pc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hCeUlkKCBpZCApIHtcclxuXHJcblx0XHR2YXIgZGZfREIgPSAkcS5kZWZlcigpO1xyXG5cdFx0dmFyIGRmX1JlcyA9ICRxLmRlZmVyKCk7XHJcblxyXG5cdFx0dmFyIGNhY2hlZEl0ZW0gPSBtb3ZpZUlkQ2FjaGUuZ2V0KCBpZCApO1xyXG5cdFx0aWYgKCBjYWNoZWRJdGVtICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBjYWNoZTonLCBjYWNoZWRJdGVtICk7XHJcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCBjYWNoZWRJdGVtICk7XHJcblx0XHRcdHJldHVybiBkZl9SZXMucHJvbWlzZTtcclxuXHRcdH1cclxuXHJcblx0XHRzZWFyY2hJZEZyb21EQiggaWQgKS50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0aWYgKCByZXMgKSB7XHJcblx0XHRcdFx0ZGZfREIucmVzb2x2ZSggcmVzICk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0ZGZfREIucmVqZWN0KCAnbm90IGZvdW5kJyApO1xyXG5cdFx0XHR9XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0XHRkZl9EQi5yZWplY3QoIGVyciApO1xyXG5cdFx0fSApO1xyXG5cclxuXHRcdGRmX0RCLnByb21pc2UudGhlbiggZnVuY3Rpb24gKCByZXNfREIgKSB7XHJcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfREIgKTtcclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRzZWFyY2hJZEZyb21BUEkoIGlkICkudGhlbiggZnVuY3Rpb24gKCByZXNfYXBpICkge1xyXG5cdFx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfYXBpICk7XHJcblx0XHRcdH0sIGZ1bmN0aW9uICggZXJyX2FwaSApIHtcclxuXHRcdFx0XHRkZl9SZXMucmVqZWN0KCBlcnJfYXBpICk7XHJcblx0XHRcdH0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoQnlUaXRsZSggc2VhcmNoT2JqICkge1xyXG5cclxuXHRcdGlmICggY3VyclBhZ2UgPiB0b3RhbFBhZ2VzICYmIHRvdGFsUGFnZXMgIT09IC0xICkge1xyXG5cdFx0XHQvLyBlbWl0IGV2ZW50IGVuZCBvZiBwYWdlXHJcblx0XHRcdEVWVC5FT1AuZW1pdCgpO1xyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblxyXG5cdFx0JGh0dHAoIHtcclxuXHRcdFx0bWV0aG9kOiAnR0VUJyxcclxuXHRcdFx0Y2FjaGU6IHRydWUsXHJcblx0XHRcdHVybDogVE1EQl9BUEkudXJsICsgJ3NlYXJjaC9tb3ZpZScsXHJcblx0XHRcdHBhcmFtczp7XHJcblx0XHRcdFx0YXBpX2tleTogVE1EQl9BUEkua2V5LFxyXG5cdFx0XHRcdHF1ZXJ5OiBzZWFyY2hPYmoucXVlcnksXHJcblx0XHRcdFx0cGFnZTogY3VyclBhZ2VcclxuXHRcdFx0fVxyXG5cdFx0fSApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHQvLyBlbWl0IGV2ZW50IHNlYXJjaCBzdWNjZXNzXHJcblx0XHRcdHNlYXJjaFJlc3VsdCA9IHNlYXJjaFJlc3VsdC5jb25jYXQoIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlcy5kYXRhLnJlc3VsdHMgKSApO1xyXG5cdFx0XHR0b3RhbFBhZ2VzID0gcmVzLmRhdGEudG90YWxfcGFnZXM7XHJcblx0XHRcdGN1cnJQYWdlICsrO1xyXG5cdFx0XHRwcmV2UmVzdWx0TGVuID0gc2VhcmNoUmVzdWx0Lmxlbmd0aDtcclxuXHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgJ3NlYXJjaEJ5VGl0bGU6JywgcmVzLCByZXMuZGF0YSApO1xyXG5cclxuXHRcdFx0Ly8gY2FjaGVcclxuXHRcdFx0cmVzLmRhdGEucmVzdWx0cy5mb3JFYWNoKCBmdW5jdGlvbiAoIGl0ZW0gKSB7XHJcblxyXG5cdFx0XHRcdGlmICggIW1vdmllSWRDYWNoZS5nZXQoIGl0ZW0uaWQgKSApIHtcclxuXHRcdFx0XHRcdGNvbnNvbGUubG9nKCBpdGVtLmlkLCBpdGVtICk7XHJcblx0XHRcdFx0XHRtb3ZpZUlkQ2FjaGUucHV0KCBpdGVtLmlkLCBpdGVtICk7XHJcblx0XHRcdFx0XHQvLyBwdXRJdGVtVG9EQiggaXRlbSApO1xyXG5cdFx0XHRcdH1cclxuXHJcblx0XHRcdH0gKTtcclxuXHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0Ly8gZW1pdCBldmVudCBzZWFyY2ggZXJyXHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzZWFyY2hCeVRpdGxlOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlc3VsdHMgKSB7XHJcblx0XHRyZXR1cm4gcmVzdWx0cy5maWx0ZXIoIGZ1bmN0aW9uICggaXRlbSApIHtcclxuXHRcdFx0cmV0dXJuICEhaXRlbS5wb3N0ZXJfcGF0aDtcclxuXHRcdH0gKTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGdldFJlcygpIHtcclxuXHRcdHJldHVybiBzZWFyY2hSZXN1bHQ7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBjbGVhclNlYXJjaCgpIHtcclxuXHRcdC8vIGVtaXQgZXZlbnQgY2xlYXJTZWFjaFxyXG5cdFx0c2VhcmNoUmVzdWx0Lmxlbmd0aCA9IDA7XHJcblx0XHRwcmV2UmVzdWx0TGVuID0gMDtcclxuXHRcdHRvdGFsUGFnZXMgPSAtMTtcclxuXHRcdGN1cnJQYWdlID0gMTtcclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRzZWFyY2hCeVRpdGxlLFxyXG5cdFx0c2VhcmNoQnlJZCxcclxuXHRcdGNsZWFyU2VhcmNoLFxyXG5cdFx0Z2V0UmVzLFxyXG5cdFx0cHJldlJlc3VsdExlbixcclxuXHRcdHB1dEl0ZW1Ub0RCLFxyXG5cdFx0bW92aWVJZENhY2hlXHJcblx0fTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5EUE9JTlRfVVJJJywgJyRodHRwJywgJyRxJywgJ2F1dGhUb2tlbicsXG5mdW5jdGlvbiAoIGxvZywgRU5EUE9JTlRfVVJJLCAkaHR0cCwgJHEsIGF1dGhUb2tlbiApIHtcblxuXHRcdHZhciBpZGVudGl0eSA9IG51bGw7XG5cdFx0dmFyIF9pZGVudGl0eVJlc29sdmVkID0gZmFsc2U7XG5cblx0XHRmdW5jdGlvbiBhdXRob3JpemUoIGZvcmNlICkge1xuXG5cdFx0XHR2YXIgZGVmZXJyZWQgPSAkcS5kZWZlcigpO1xuXG5cdFx0XHRpZiAoIGZvcmNlICkgaWRlbnRpdHkgPSBudWxsO1xuXG5cdFx0XHRpZiAoIGlkZW50aXR5ICE9PSBudWxsICkge1xuXG5cdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcblxuXHRcdFx0fSBlbHNlIHtcblxuXHRcdFx0XHQkaHR0cC5nZXQoIEVORFBPSU5UX1VSSSArICdhdXRoJywgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcblx0XHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cblx0XHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnYXV0aC5hdXRob3JpemUoKTonLCByZXMsIHJlcy5kYXRhICk7XG5cdFx0XHRcdFx0XHRpZGVudGl0eSA9IHJlcy5kYXRhO1xuXHRcdFx0XHRcdFx0X2lkZW50aXR5UmVzb2x2ZWQgPSB0cnVlO1xuXHRcdFx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggdHJ1ZSApO1xuXG5cdFx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cblx0XHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdhdXRob3JpemUnLCBlcnIsIGVyci5kYXRhICk7XG5cdFx0XHRcdFx0XHQvLyB0b2RvIGlmIGp3dCBleHBpcmVkICwgZGVhdXRob3JpemUsIHJlbW92ZSBsb2NhbCBzdG9yYWdlLCByZWRpcmVjdFxuXHRcdFx0XHRcdFx0X2lkZW50aXR5UmVzb2x2ZWQgPSB0cnVlO1xuXHRcdFx0XHRcdFx0ZGVmZXJyZWQucmVqZWN0KCBlcnIgKTtcblxuXHRcdFx0XHRcdH0gKTtcblxuXHRcdFx0fVxuXG5cdFx0XHRyZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcblxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGRlYXV0aG9yaXplKCkge1xuXHRcdFx0YXV0aFRva2VuLnJlbW92ZVRva2VuKCk7XG5cdFx0XHRpZGVudGl0eSA9IG51bGw7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gaXNBdXRoZW50aWNhdGVkKCkge1xuXHRcdFx0cmV0dXJuIGlkZW50aXR5ICE9PSBudWxsO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGlkZW50aXR5UmVzb2x2ZWQoKSB7XG5cdFx0XHRyZXR1cm4gX2lkZW50aXR5UmVzb2x2ZWQ7XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblxuXHRcdFx0YXV0aG9yaXplLFxuXHRcdFx0ZGVhdXRob3JpemUsXG5cdFx0XHRpc0F1dGhlbnRpY2F0ZWQsXG5cdFx0XHRpZGVudGl0eVJlc29sdmVkXG5cblx0XHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2F1dGhUb2tlbicsIGZ1bmN0aW9uICggYXV0aFRva2VuICkge1xuXG5cdGZ1bmN0aW9uIHJlcXVlc3QoIGNvbmZpZyApIHtcblxuXHRcdGlmICggY29uZmlnLnJlcXVpcmVBdXRoICkge1xuXHRcdFx0dmFyIHRva2VuID0gYXV0aFRva2VuLmdldFRva2VuKCk7XG5cdFx0XHRpZiAoIHRva2VuICkge1xuXHRcdFx0XHQvLyBodHRwOi8vc2VsZi1pc3N1ZWQuaW5mby9kb2NzL2RyYWZ0LWlldGYtb2F1dGgtdjItYmVhcmVyLmh0bWwgICBzZWN0aW9uIDIuMVxuXHRcdFx0XHQvLyBodHRwczovL2RldmVsb3BlcnMuZ29vZ2xlLmNvbS9nbWFpbC9tYXJrdXAvYWN0aW9ucy92ZXJpZnlpbmctYmVhcmVyLXRva2Vuc1xuXHRcdFx0XHQvLyBodHRwOi8vd3d3LnczLm9yZy9Qcm90b2NvbHMvcmZjMjYxNi9yZmMyNjE2LXNlYzQuaHRtbCBzZWN0aW9uIDQuMiBoZWFkZXIgZmllbGQgbmFtZSBjYXNlIGluc2Vuc2l0aXZlXG5cdFx0XHRcdGNvbmZpZy5oZWFkZXJzLkF1dGhvcml6YXRpb24gPSAnQmVhcmVyICcgKyB0b2tlbjtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gY29uZmlnO1xuXG5cdH1cblxuXHRmdW5jdGlvbiByZXNwb25zZSggcmVzICkge1xuXHRcdHJldHVybiByZXM7XG5cdH1cblxuXHRyZXR1cm4ge1xuXG5cdFx0cmVxdWVzdCxcblx0XHRyZXNwb25zZVxuXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHdpbmRvdycsIGZ1bmN0aW9uICggbG9nLCAkd2luZG93ICkge1xuXG5cdHZhciBzdG9yYWdlID0gJHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG5cdHZhciBjYWNoZWRUb2tlbiA9IG51bGw7XG5cblx0ZnVuY3Rpb24gc2V0VG9rZW4oIHRva2VuICkge1xuXHRcdGNhY2hlZFRva2VuID0gdG9rZW47XG5cdFx0c3RvcmFnZS5zZXRJdGVtKCAnand0JywgdG9rZW4gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdldFRva2VuKCkge1xuXHRcdGlmICggIWNhY2hlZFRva2VuICkge1xuXHRcdFx0Y2FjaGVkVG9rZW4gPSBzdG9yYWdlLmdldEl0ZW0oICdqd3QnICk7XG5cdFx0fVxuXHRcdHJldHVybiBjYWNoZWRUb2tlbjtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZVRva2VuKCkge1xuXHRcdGNhY2hlZFRva2VuID0gbnVsbDtcblx0XHRzdG9yYWdlLnJlbW92ZUl0ZW0oICdqd3QnICk7XG5cdFx0bG9nLmRlYnVnKCAnYXV0aCcsICd0b2tlbiByZW1vdmVkJyApO1xuXHR9XG5cblx0ZnVuY3Rpb24gaGFzVG9rZW4oKSB7XG5cdFx0cmV0dXJuICEhZ2V0VG9rZW4oKTtcblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRzZXRUb2tlbixcblx0XHRnZXRUb2tlbixcblx0XHRyZW1vdmVUb2tlbixcblx0XHRoYXNUb2tlblxuXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcclxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgJGh0dHAsIEVORFBPSU5UX1VSSSwgYXV0aFRva2VuLCAkc3RhdGUgKSAge1xyXG5cclxuXHR2YXIgdm0gPSB0aGlzO1xyXG5cdHZtLnVzZXIgPSB7XHJcblx0XHRlbWFpbDogJycsXHJcblx0XHRwYXNzd29yZDogJydcclxuXHR9O1xyXG5cclxuXHR2bS5zaWduaW4gPSBmdW5jdGlvbigpIHtcclxuXHJcblx0XHRpZiAoIHZtLnVzZXIuZW1haWwgPT09ICcnIHx8IHZtLnVzZXIucGFzc3dvcmQgPT09ICcnICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblxyXG5cdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ25pbicsIHZtLnVzZXIgKVxyXG5cdFx0XHQudGhlbiggZnVuY3Rpb24oIHJlcyApIHtcclxuXHRcdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ3NpZ25pbicsIHJlcywgcmVzLmRhdGEgKTtcclxuXHRcdFx0XHRhdXRoVG9rZW4uc2V0VG9rZW4oIHJlcy5kYXRhLnRva2VuICk7XHJcblx0XHRcdFx0JHN0YXRlLmdvKCAnY29sbGVjdGlvbicgKTtcclxuXHRcdFx0fSwgZnVuY3Rpb24oIGVyciwgc3RhdHVzICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzaWduaW4nLCBlcnIgKTtcclxuXHRcdFx0fSApO1xyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZScsICdhdXRoJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggJHN0YXRlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSAge1xyXG5cclxuXHRhdXRoLmRlYXV0aG9yaXplKCk7XHJcblx0bW92aWVDb2xsZWN0aW9uLl9jbGVhcigpO1xyXG5cdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsICRodHRwLCBFTkRQT0lOVF9VUkksIGF1dGhUb2tlbiwgJHN0YXRlICkge1xuXG5cdFx0dmFyIHZtID0gdGhpcztcblx0XHR2bS51c2VyID0ge307XG5cblx0XHR2bS5zaWdudXAgPSBmdW5jdGlvbiAoKSB7XHJcblxuXHRcdFx0aWYgKCB2bS51c2VyLmVtYWlsID09PSB1bmRlZmluZWQgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gdW5kZWZpbmVkICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnc2lnbmluZyB1cC4uLicgKTtcclxuXHRcdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ251cCcsIHZtLnVzZXIgKVxyXG5cdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdSZWdpc3RlcmVkLicsIHJlcyApO1xyXG5cclxuXHRcdFx0XHRcdGF1dGhUb2tlbi5zZXRUb2tlbiggcmVzLmRhdGEudG9rZW4gKTtcclxuXHRcdFx0XHRcdCRzdGF0ZS5nbyggJ2NvbGxlY3Rpb24nICk7XHJcblxuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgZXJyICk7XG5cdFx0XHRcdFx0dm0uZm9ybS4kc3VibWl0dGVkID0gZmFsc2U7XHJcblxuXHRcdFx0XHR9ICk7XHJcblxuXHRcdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckcm9vdFNjb3BlJywgZnVuY3Rpb24gKCAkcm9vdFNjb3BlICkge1xyXG5cclxuXHR2YXIgRVZUID0ge1xyXG5cclxuXHRcdEVPUDoge1xyXG5cdFx0XHRsaXN0ZW46IGZ1bmN0aW9uICggY2IgKSB7ICRyb290U2NvcGUuJG9uKCAnRU9QJywgY2IgKTsgfSxcclxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdFT1AnICk7IH1cclxuXHRcdH0sXHJcblx0XHRjb2xsZWN0aW9uTW9kYWxPcGVuOiB7XHJcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdjb2xsZWN0aW9uTW9kYWxPcGVuJywgY2IgKTsgfSxcclxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdjb2xsZWN0aW9uTW9kYWxPcGVuJyApOyB9XHJcblx0XHR9LFxyXG5cdFx0Y29sbGVjdGlvbk1vZGFsQ2xvc2U6IHtcclxuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ2NvbGxlY3Rpb25Nb2RhbENsb3NlJywgY2IgKTsgfSxcclxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdjb2xsZWN0aW9uTW9kYWxDbG9zZScgKTsgfVxyXG5cdFx0fVxyXG5cclxuXHR9O1xyXG5cclxuXHRyZXR1cm4gRVZUO1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xuXG5cdHZhciBkZWJ1Z0VuYWJsZWQgPSBmYWxzZTtcblx0dmFyIGRlYnVnTmFtZXNwYWNlcyA9IFtdO1xuXG5cdHRoaXMuZW5hYmxlRGVidWcgPSBmdW5jdGlvbiAoKSB7XG5cdFx0ZGVidWdFbmFibGVkID0gdHJ1ZTtcblx0fTtcblxuXHR0aGlzLmVuYWJsZURlYnVnTmFtZXNwYWNlID0gZnVuY3Rpb24gKCkge1xuXHRcdGZvciAoIGxldCBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKyApIHtcblx0XHRcdGRlYnVnTmFtZXNwYWNlcy5wdXNoKCBhcmd1bWVudHNbIGkgXSApO1xuXHRcdH1cblx0fTtcblxuXHR0aGlzLiRnZXQgPSAoKSA9PiB7XG5cblx0XHRmdW5jdGlvbiBkZWJ1ZygpIHtcblx0XHRcdGlmICggIWRlYnVnRW5hYmxlZCApIHJldHVybjtcclxuXHRcdFx0dmFyIGRlYnVnTmFtZSA9IGFyZ3VtZW50c1sgMCBdO1xyXG5cdFx0XHR2YXIgc2xpY2VkQXJncyA9IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKCBhcmd1bWVudHMsIDEgKTtcclxuXHRcdFx0aWYgKCBkZWJ1Z05hbWUgPT09ICdlcnInICkge1xyXG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IuYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcclxuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lID09PSAnaW5mbycgKSB7XHJcblx0XHRcdFx0Y29uc29sZS5pbmZvLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XHJcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ3dhcm4nICkge1xyXG5cdFx0XHRcdGNvbnNvbGUud2Fybi5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWVzcGFjZXMuaW5kZXhPZiggZGVidWdOYW1lICkgIT09IC0xICkge1xyXG5cdFx0XHRcdGNvbnNvbGUubG9nLmFwcGx5KCBjb25zb2xlLCBbIGRlYnVnTmFtZSBdLmNvbmNhdCggc2xpY2VkQXJncyApICk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblx0XHRcdGRlYnVnXG5cdFx0fTtcblxuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdGZ1bmN0aW9uIGRlYm91bmNlKCBmdW5jLCB3YWl0LCBpbW1lZGlhdGUgKSB7XHJcblx0XHR2YXIgX3RoaXMgPSB0aGlzLFxyXG5cdFx0XHRfYXJndW1lbnRzID0gYXJndW1lbnRzO1xyXG5cclxuXHRcdHZhciB0aW1lb3V0O1xyXG5cdFx0cmV0dXJuIGZ1bmN0aW9uICgpIHtcclxuXHJcblx0XHRcdHZhciBjb250ZXh0ID0gX3RoaXMsXHJcblx0XHRcdFx0YXJncyA9IF9hcmd1bWVudHM7XHJcblx0XHRcdHZhciBsYXRlciA9IGZ1bmN0aW9uIGxhdGVyKCkge1xyXG5cclxuXHRcdFx0XHR0aW1lb3V0ID0gbnVsbDtcclxuXHRcdFx0XHRpZiAoICFpbW1lZGlhdGUgKSBmdW5jLmFwcGx5KCBjb250ZXh0LCBhcmdzICk7XHJcblx0XHRcdH07XHJcblx0XHRcdHZhciBjYWxsTm93ID0gaW1tZWRpYXRlICYmICF0aW1lb3V0O1xyXG5cdFx0XHRjbGVhclRpbWVvdXQoIHRpbWVvdXQgKTtcclxuXHRcdFx0dGltZW91dCA9IHNldFRpbWVvdXQoIGxhdGVyLCB3YWl0ICk7XHJcblx0XHRcdGlmICggY2FsbE5vdyApIGZ1bmMuYXBwbHkoIGNvbnRleHQsIGFyZ3MgKTtcclxuXHRcdH07XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0ZGVib3VuY2VcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRodHRwUHJvdmlkZXInLCBmdW5jdGlvbiAoICRodHRwUHJvdmlkZXIgKSB7XHJcblx0JGh0dHBQcm92aWRlci5pbnRlcmNlcHRvcnMucHVzaCggJ2F1dGhJbnRlcmNlcHRvcicgKTtcclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZ1Byb3ZpZGVyJywgJyRodHRwUHJvdmlkZXInLCBmdW5jdGlvbiAoIGxvZ1Byb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xyXG5cclxuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1ZygpO1xyXG5cdC8vIGxvZ1Byb3ZpZGVyLmVuYWJsZURlYnVnTmFtZXNwYWNlKCAnaW5mbycsICdlcnInLCAnYXV0aCcsICdhcGknLCAnY29sbGVjdGlvbicgKTtcclxuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1Z05hbWVzcGFjZSggJ2luZm8nLCAnZXJyJyApO1xyXG5cclxuXHQkaHR0cFByb3ZpZGVyLnVzZUxlZ2FjeVByb21pc2VFeHRlbnNpb25zKCBmYWxzZSApO1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZVByb3ZpZGVyJywgJyR1cmxSb3V0ZXJQcm92aWRlcicsICckaHR0cFByb3ZpZGVyJyxcclxuZnVuY3Rpb24gKCAkc3RhdGVQcm92aWRlciwgJHVybFJvdXRlclByb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xyXG5cclxuXHQkdXJsUm91dGVyUHJvdmlkZXIub3RoZXJ3aXNlKCAnLycgKTtcclxuXHJcblx0JHN0YXRlUHJvdmlkZXJcclxuXHRcdC5zdGF0ZSggJ2hlbGl4Jywge1xyXG5cdFx0XHR1cmw6ICcvJyxcclxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2hlbGl4Lmh0bWwnXHJcblx0XHR9IClcclxuXHRcdC5zdGF0ZSggJ3NpZ251cCcsIHtcclxuXHRcdFx0dXJsOiAnL3NpZ251cCcsXHJcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9zaWdudXAuaHRtbCcsXHJcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWdudXBDdHJsJyxcclxuXHRcdFx0Y29udHJvbGxlckFzOiAnc2lnbnVwJ1xyXG5cdFx0fSApXHJcblx0XHQuc3RhdGUoICdzaWduaW4nLCB7XHJcblx0XHRcdHVybDogJy9zaWduaW4nLFxyXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvc2lnbmluLmh0bWwnLFxyXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbmluQ3RybCcsXHJcblx0XHRcdGNvbnRyb2xsZXJBczogJ3NpZ25pbidcclxuXHRcdH0gKVxyXG5cdFx0LnN0YXRlKCAnc2lnbm91dCcsIHtcclxuXHRcdFx0dXJsOiAnL3NpZ25vdXQnLFxyXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbm91dEN0cmwnXHJcblx0XHR9IClcclxuXHRcdC5zdGF0ZSggJ21vdmllRGV0YWlsJywge1xyXG5cdFx0XHR1cmw6ICcvbW92aWUvOm1vdmllSWQnLFxyXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvbW92aWVEZXRhaWwuaHRtbCcsXHJcblx0XHRcdGNvbnRyb2xsZXI6ICdtb3ZpZURldGFpbEN0cmwnLFxyXG5cdFx0XHRjb250cm9sbGVyQXM6ICdtZCcsXHJcblx0XHRcdHJlc29sdmU6IHtcclxuXHRcdFx0XHRtb3ZpZUl0ZW06IFsgJyRzdGF0ZVBhcmFtcycsICdUTURiJywgZnVuY3Rpb24gKCAkc3RhdGVQYXJhbXMsIFRNRGIgKSB7XHJcblx0XHRcdFx0XHRyZXR1cm4gVE1EYi5zZWFyY2hCeUlkKCAkc3RhdGVQYXJhbXMubW92aWVJZCApO1xyXG5cdFx0XHRcdH0gXVxyXG5cdFx0XHR9XHJcblx0XHR9IClcclxuXHRcdC5zdGF0ZSgnY29sbGVjdGlvbicsIHtcclxuXHRcdFx0dXJsOiAnL2NvbGxlY3Rpb24nLFxyXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvY29sbGVjdGlvbi5odG1sJyxcclxuXHRcdFx0Y29udHJvbGxlcjogJ21vdmllQ29sbGVjdGlvbkN0cmwnLFxyXG5cdFx0XHRjb250cm9sbGVyQXM6ICdtYycsXHJcblx0XHRcdHJlc29sdmU6IHtcclxuXHRcdFx0XHRhdXRob3JpemU6IFsgJ2F1dGgnLCBmdW5jdGlvbiAoIGF1dGggKSB7XHJcblx0XHRcdFx0XHRyZXR1cm4gYXV0aC5hdXRob3JpemUoKTtcclxuXHRcdFx0XHR9IF0sXHJcblx0XHRcdFx0cmVzb2x2ZWRDb2xsZWN0aW9uOiBbICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoIG1vdmllQ29sbGVjdGlvbiApIHtcclxuXHRcdFx0XHRcdHJldHVybiBtb3ZpZUNvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTtcclxuXHRcdFx0XHR9IF1cclxuXHRcdFx0fVxyXG5cdFx0fSlcclxuXHQ7XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHdpbmRvdycsICdFTkdJTkUnLCAndXRpbCcsIGZ1bmN0aW9uICggJHdpbmRvdywgRU5HSU5FLCB1dGlsICkge1xuXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQgKSB7XG5cblx0XHRFTkdJTkUuYXR0YWNoUmVuZGVyZXIoICRlbGVtZW50ICk7XHJcblx0XHQkKCAkd2luZG93ICkub24oICdyZXNpemUnLCB1dGlsLmRlYm91bmNlKCBFTkdJTkUub25XaW5kb3dSZXNpemUsIDEwMCApICk7XHJcblx0XHQkZWxlbWVudC5vbiggJ3doZWVsJywgZnVuY3Rpb24gKCBldnQgKSB7XG5cdFx0XHRFTkdJTkUuJCQud2hlZWxfZHkgPSAtTWF0aC5zaWduKCBldnQub3JpZ2luYWxFdmVudC5kZWx0YVkgKTtcblx0XHR9ICk7XG5cclxuXHRcdEVOR0lORS5zdGFydCgpO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBpZD1cImNhbnZhcy1jb250YWluZXJcIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckd2luZG93JywgZnVuY3Rpb24gKCAkd2luZG93ICkge1xuXG5cdHZhciAkJCA9IHtcblx0XHRjYW52YXM6IG51bGwsXG5cdFx0c3RhdHM6IG5ldyBTdGF0cygpLFxuXHRcdHNjZW5lOiBuZXcgVEhSRUUuU2NlbmUoKSxcblx0XHR3aWR0aDogJCh3aW5kb3cpLndpZHRoKCksXG5cdFx0aGVpZ2h0OiAkKHdpbmRvdykuaGVpZ2h0KCksXG5cdFx0Y2FtZXJhOiBuZXcgVEhSRUUuUGVyc3BlY3RpdmVDYW1lcmEoIDcwLCB0aGlzLndpZHRoIC8gdGhpcy5oZWlnaHQsIDEwLCAxMDAwMDAgKSxcblx0XHRyZW5kZXJlcjogbmV3IFRIUkVFLkNTUzNEUmVuZGVyZXIoKSxcblx0XHRzY3JlZW5fcmF0aW86IHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCxcblx0XHRwaXhlbF9yYXRpbzogJHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDEsXG5cdFx0bW91c2VfeDogdGhpcy53aWR0aCAqIDAuNSxcblx0XHRtb3VzZV95OiB0aGlzLmhlaWdodCAqIDAuNSxcblx0XHR3aGVlbF9keTogMFxuXHR9O1xuXG5cdCQkLnJlbmRlcmVyLnNldFNpemUoICQkLndpZHRoLCAkJC5oZWlnaHQgKTtcblxuXHRmdW5jdGlvbiBhdHRhY2hSZW5kZXJlciggY2FudmFzICkge1xuXHRcdCQkLmNhbnZhcyA9IGNhbnZhcztcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5yZW5kZXJlci5kb21FbGVtZW50ICk7XG5cdFx0Y2FudmFzLmFwcGVuZCggJCQuc3RhdHMuZG9tRWxlbWVudCApO1xuXHR9XG5cblx0ZnVuY3Rpb24gb25XaW5kb3dSZXNpemUoKSB7XG5cdFx0JCQud2lkdGggPSAkKHdpbmRvdykud2lkdGgoKTtcblx0XHQkJC5oZWlnaHQgPSAkKHdpbmRvdykuaGVpZ2h0KCk7XG5cdFx0JCQucGl4ZWxfcmF0aW8gPSAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMTtcblx0XHQkJC5zY3JlZW5fcmF0aW8gPSAkJC53aWR0aCAvICQkLmhlaWdodDtcblx0XHQkJC5jYW1lcmEuYXNwZWN0ID0gJCQuc2NyZWVuX3JhdGlvO1xuXHRcdCQkLmNhbWVyYS51cGRhdGVQcm9qZWN0aW9uTWF0cml4KCk7XG5cdFx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xuXHR9XG5cblx0ZnVuY3Rpb24gc2V0dXAoKSB7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHVwZGF0ZSgpIHtcblxuXHRcdGlmICggTWF0aC5hYnMoICQkLndoZWVsX2R5ICkgPiAwLjAwMSApIHtcblx0XHRcdCQkLmNhbWVyYS5wb3NpdGlvbi55ICs9ICQkLndoZWVsX2R5ICogMS4wO1xuXHRcdFx0JCQuY2FtZXJhLnJvdGF0ZVkoICQkLndoZWVsX2R5ICogMC4wMjUgKTtcblx0XHRcdCQkLndoZWVsX2R5ICo9IDAuOTU7XG5cdFx0fVxuXG5cdH1cblxuXHQvLyAtLS0tICBkcmF3IGxvb3Bcblx0ZnVuY3Rpb24gcnVuKCkge1xuXG5cdFx0cmVxdWVzdEFuaW1hdGlvbkZyYW1lKCBydW4gKTtcblx0XHR1cGRhdGUoKTtcblx0XHQkJC5yZW5kZXJlci5yZW5kZXIoICQkLnNjZW5lLCAkJC5jYW1lcmEgKTtcblx0XHQkJC5zdGF0cy51cGRhdGUoKTtcblxuXHR9XG5cblx0ZnVuY3Rpb24gc3RhcnQoKSB7XG5cdFx0c2V0dXAoKTtcblx0XHRydW4oKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlc2V0Q2FtZXJhKCkge1xuXHRcdCQkLmNhbWVyYS5wb3NpdGlvbi5zZXQoIDAsIDAsIDAgKTtcblx0XHQkJC5jYW1lcmEucm90YXRpb24uc2V0KCAwLCAwLCAwICk7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdCQkLFxuXHRcdGF0dGFjaFJlbmRlcmVyLFxuXHRcdG9uV2luZG93UmVzaXplLFxuXHRcdHN0YXJ0LFxuXHRcdHJlc2V0Q2FtZXJhLFxuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VOR0lORScsICckY29tcGlsZScsICckcm9vdFNjb3BlJyxcclxuZnVuY3Rpb24gKCBsb2csIEVOR0lORSwgJGNvbXBpbGUsICRyb290U2NvcGUgKSB7XHJcblxuXHR2YXIgYWxsUG9zdGVycyA9IG5ldyBUSFJFRS5PYmplY3QzRCgpO1xuXHRFTkdJTkUuJCQuc2NlbmUuYWRkKCBhbGxQb3N0ZXJzICk7XG5cblx0ZnVuY3Rpb24gbWFrZUhlbGl4UG9zdGVycyggcG9zdGVyT2JqZWN0TXVsdGksIG9mZnNldFN0YXJ0SWR4ICkge1xuXHJcblx0XHR2YXIgdmVjdG9yID0gbmV3IFRIUkVFLlZlY3RvcjMoKTtcclxuXHRcdHZhciByYWRpdXMgPSA5MDA7XHJcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBwb3N0ZXJPYmplY3RNdWx0aS5sZW5ndGg7IGkrKyApIHtcblxuXHRcdFx0dmFyICRpc29sYXRlZFNjb3BlID0gJHJvb3RTY29wZS4kbmV3KCB0cnVlICk7XG5cdFx0XHQkaXNvbGF0ZWRTY29wZS5tb3ZpZUl0ZW0gPSBwb3N0ZXJPYmplY3RNdWx0aVsgaSBdO1xyXG5cclxuXHRcdFx0dmFyIHBvc3RlckRpcmVjdGl2ZUVsZW0gPSAkY29tcGlsZSggJzxwb3N0ZXI+PC9wb3N0ZXI+JyApKCAkaXNvbGF0ZWRTY29wZSApWyAwIF07XG5cdFx0XHR2YXIgY3NzM2RPYmogPSBuZXcgVEhSRUUuQ1NTM0RPYmplY3QoIHBvc3RlckRpcmVjdGl2ZUVsZW0gKTtcclxuXHJcblx0XHRcdC8vIHRhZyBhbG9nIGFuIGlzb2xhdGVkU2NvcGUgdG8gYmUgZGVzdHJveSB3aGVuIGRpc3Bvc2UgYW4gZWxlbWVudFxyXG5cdFx0XHRjc3MzZE9iai5zY29wZSA9ICRpc29sYXRlZFNjb3BlO1xyXG5cclxuXHRcdFx0dmFyIGhpZHggPSBpICsgb2Zmc2V0U3RhcnRJZHg7XG5cdFx0XHR2YXIgcGhpID0gaGlkeCAqIDAuMTc1ICsgTWF0aC5QSTtcclxuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueCA9IC0gcmFkaXVzICogTWF0aC5zaW4oIHBoaSApO1xyXG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi55ID0gLSAoIGhpZHggKiA4ICkgKyAyMDA7XHJcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnogPSByYWRpdXMgKiBNYXRoLmNvcyggcGhpICk7XHJcblxyXG5cdFx0XHR2ZWN0b3Iuc2V0KCAtY3NzM2RPYmoucG9zaXRpb24ueCAqIDIsIGNzczNkT2JqLnBvc2l0aW9uLnksIC1jc3MzZE9iai5wb3NpdGlvbi56ICogMiApO1xyXG5cblx0XHRcdGNzczNkT2JqLmxvb2tBdCggdmVjdG9yICk7XHJcblx0XHRcdGFsbFBvc3RlcnMuYWRkKCBjc3MzZE9iaiApO1xuXG5cdFx0fVxuXG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICdjdXJyIHBvc3RlcnM6JywgYWxsUG9zdGVycy5jaGlsZHJlbi5sZW5ndGggKTtcclxuXHJcblx0fVxuXG5cdGZ1bmN0aW9uIGNsZWFyQWxsKCkge1xyXG5cdFx0YWxsUG9zdGVycy5jaGlsZHJlbi5mb3JFYWNoKCBmdW5jdGlvbiAoIHBvc3RlciApIHtcclxuXHRcdFx0cG9zdGVyLmRpc3Bvc2VFbGVtZW50KCk7XHJcblx0XHRcdHBvc3Rlci5zY29wZS4kZGVzdHJveSgpO1xyXG5cdFx0fSApO1xyXG5cdFx0YWxsUG9zdGVycy5jaGlsZHJlbi5sZW5ndGggPSAwOyAvLyBjbGVhciBpdGVtc1xyXG5cdH1cclxuXG5cdHJldHVybiB7XG5cdFx0bWFrZUhlbGl4UG9zdGVycyxcblx0XHRjbGVhckFsbFxuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlJywgJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCBmdW5jdGlvbiAoICRzdGF0ZSwgY29sbGVjdGlvbk1vZGFsU2VydmljZSApIHtcclxuXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQgKSB7XG5cclxuXHRcdC8vICRzY29wZS5tb3ZpZUl0ZW0gb2JqIGlzIHBhc3NlZCB0aHJ1IGlzb2xhdGVkU2NvcGUgdmlhIGNvbXBpbGVkIGRpcmVjdGl2ZSBpbiBoZWxpeC5mYWMuanNcclxuXHRcdHZhciBpbWcgPSBuZXcgSW1hZ2UoKTtcclxuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC93MTU0LycgKyAkc2NvcGUubW92aWVJdGVtLnBvc3Rlcl9wYXRoO1xyXG5cdFx0aW1nLm9ubG9hZCA9IGZ1bmN0aW9uICgpIHtcclxuXHJcblx0XHRcdC8vIHRvZG8gbW92ZSBjc3MgaW50byBzYXNzLCB1c2UgY2xhc3MgaW5zdGVhZFxyXG5cdFx0XHQkZWxlbWVudC5jc3MoIHtcclxuXHRcdFx0XHQnd2lkdGgnOiAnMTUwcHgnLFxyXG5cdFx0XHRcdCdoZWlnaHQnOiAnMjMwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXJlcGVhdCc6ICduby1yZXBlYXQnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXNpemUnOiAnMTUwcHggMjMwcHgnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknLFxyXG5cdFx0XHRcdCdkaXNwbGF5JzogJ25vbmUnIC8vIHJlcXVpcmVkIGZvciBmYWRlSW4gYW5pbWF0aW9uXHJcblx0XHRcdH0gKTtcclxuXHRcdFx0JGVsZW1lbnQuZmFkZUluKCAxNTAwICk7XHJcblxyXG5cdFx0fTtcclxuXHRcdGltZy5zcmMgPSBpbWdVcmw7XHJcblxuXHRcdCRlbGVtZW50Lm9uKCAnY2xpY2snLCBmdW5jdGlvbiAoIGV2dCApIHtcclxuXHRcdFx0JHN0YXRlLmdvKCAnbW92aWVEZXRhaWwnLCB7IG1vdmllSWQ6ICRzY29wZS5tb3ZpZUl0ZW0uaWQgfSApO1xyXG5cdFx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLnNldEFjdGl2ZUl0ZW0oICRzY29wZS5tb3ZpZUl0ZW0gKTtcclxuXHRcdH0gKTtcblxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZXN0cmljdDogJ0UnLFxuXHRcdHJlcGxhY2U6IHRydWUsXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHR0ZW1wbGF0ZTogJzxkaXYgY2xhc3M9XCJwb3N0ZXJFbGVtXCI+PC9kaXY+J1xuXHR9O1xuXG59IF07XHJcbiIsImFuZ3VsYXIubW9kdWxlKCAnYXBwJywgW1xuXHQndWkucm91dGVyJyxcblx0J25nQW5pbWF0ZSdcbl0gKVxuLmNvbnN0YW50KCAnRU5EUE9JTlRfVVJJJywgJ2h0dHA6Ly9sb2NhbGhvc3Q6ODAwMS8nIClcbi5jb25zdGFudCggJ1RNREJfQVBJJywge1xuXHRrZXk6ICczNzRjMDM0MmE2NDA2ZGZlMGFlYjNkZTJlYTA0MmM1OScsXG5cdHVybDogJ2h0dHA6Ly9hcGkudGhlbW92aWVkYi5vcmcvMy8nXG59IClcblxuLnByb3ZpZGVyKCAnbG9nJywgcmVxdWlyZSggJy4vY29tbW9uL2xvZy5wdi5qcycgKSApXG4uZmFjdG9yeSggJ3V0aWwnLCByZXF1aXJlKCAnLi9jb21tb24vdXRpbC5qcycgKSApXG4uZmFjdG9yeSggJ0VWVCcsIHJlcXVpcmUoICcuL2NvbW1vbi9ldmVudHMuZmFjLmpzJyApIClcblxuLmZhY3RvcnkoICdUTURiJywgcmVxdWlyZSggJy4vQVBJL1RNRGIuZmFjLmpzJyApIClcblxuLmNvbnRyb2xsZXIoICdtYWluQ3RybCcsIHJlcXVpcmUoICcuL21haW4uY3RybC5qcycgKSApXG4uZmFjdG9yeSggJ0VOR0lORScsIHJlcXVpcmUoICcuL2hlbGl4L2VuZ2luZS5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdoZWxpeCcsIHJlcXVpcmUoICcuL2hlbGl4L2hlbGl4LmZhYy5qcycgKSApXG4uZGlyZWN0aXZlKCAnZGlzcGxheScsIHJlcXVpcmUoICcuL2hlbGl4L2Rpc3BsYXkuZGlyLmpzJyApIClcbi5kaXJlY3RpdmUoICdwb3N0ZXInLCByZXF1aXJlKCAnLi9oZWxpeC9wb3N0ZXIuZGlyLmpzJyApIClcblxuLmNvbnRyb2xsZXIoICdtb3ZpZURldGFpbEN0cmwnLCByZXF1aXJlKCAnLi9tb3ZpZURldGFpbC5jdHJsLmpzJyApIClcblxuLmZhY3RvcnkoICdhdXRoJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2F1dGhUb2tlbicsIHJlcXVpcmUoICcuL2F1dGgvYXV0aFRva2VuLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2F1dGhJbnRlcmNlcHRvcicsIHJlcXVpcmUoICcuL2F1dGgvYXV0aEludGVyY2VwdG9yLmZhYy5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ251cEN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ251cC5jdHJsLmpzJyApIClcbi5jb250cm9sbGVyKCAnc2lnbmluQ3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbmluLmN0cmwuanMnICkgKVxuLmNvbnRyb2xsZXIoICdzaWdub3V0Q3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbm91dC5jdHJsLmpzJyApIClcblxuLmNvbnRyb2xsZXIoICdtb3ZpZUNvbGxlY3Rpb25DdHJsJywgcmVxdWlyZSggJy4vbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzJyApIClcbi5mYWN0b3J5KCAnbW92aWVDb2xsZWN0aW9uJywgcmVxdWlyZSggJy4vbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlJywgcmVxdWlyZSggJy4vbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UuZmFjLmpzJyApIClcbi5kaXJlY3RpdmUoICdjb2xsZWN0aW9uTW9kYWwnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsLmRpci5qcycgKSApXG4uZGlyZWN0aXZlKCAnY29sbGVjdGlvbkl0ZW0nLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbkl0ZW0uZGlyLmpzJyApIClcblxuLmNvbmZpZyggcmVxdWlyZSggJy4vY29uZmlnL3JvdXRlQ29uZmlnLmpzJyApIClcbi5jb25maWcoIHJlcXVpcmUoICcuL2NvbmZpZy9sb2dDb25maWcuanMnICkgKVxuLmNvbmZpZyggcmVxdWlyZSggJy4vY29uZmlnL2h0dHBDb25maWcuanMnICkgKVxuLnJ1biggWyAnbG9nJywgJyRyb290U2NvcGUnLCAnJHN0YXRlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCBsb2csICRyb290U2NvcGUsICRzdGF0ZSwgYXV0aCwgbW92aWVDb2xsZWN0aW9uICkge1xuXG5cdGF1dGguYXV0aG9yaXplKCB0cnVlICk7XG5cblx0bW92aWVDb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk7XG5cblx0JHJvb3RTY29wZS4kb24oICckc3RhdGVDaGFuZ2VFcnJvcicsIGZ1bmN0aW9uICggZXZlbnQsIHRvU3RhdGUsIHRvUGFyYW1zLCBmcm9tU3RhdGUsIGZyb21QYXJhbXMsIGVycm9yICkge1xuXG5cdFx0ZXZlbnQucHJldmVudERlZmF1bHQoKTsgLy8gcHJldmVudCB0cmFuc2l0aW9uXG5cdFx0bG9nLmRlYnVnKCAnd2FybicsIGVycm9yICk7XG5cdFx0aWYgKCBlcnJvciApIHtcblx0XHRcdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcblx0XHR9XG5cblx0fSApO1xuXG59IF0gKVxuO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ1RNRGInLCAnRVZUJywgJ2hlbGl4JywgJ0VOR0lORScsICdhdXRoJywgJyRzdGF0ZScsXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCBUTURiLCBFVlQsIGhlbGl4LCBFTkdJTkUsIGF1dGgsICRzdGF0ZSApIHtcblxuXHR2YXIgdm0gPSB0aGlzO1xuXHR2bS5hdXRoID0gYXV0aDtcblx0dm0uc2VhcmNoID0ge1xuXHRcdHF1ZXJ5OiAnJyxcblx0fTtcblx0dm0ubW92aWVJdGVtcyA9IG51bGw7XG5cblx0JHNjb3BlLiR3YXRjaCggVE1EYi5nZXRSZXMsIGZ1bmN0aW9uICggbW92SXRlbXMgKSB7XG5cblx0XHR2bS5tb3ZpZUl0ZW1zID0gbW92SXRlbXM7XG5cdFx0aGVsaXgubWFrZUhlbGl4UG9zdGVycyggbW92SXRlbXMuc2xpY2UoIFRNRGIucHJldlJlc3VsdExlbiApLCBUTURiLnByZXZSZXN1bHRMZW4gKTtcblxuXHR9LCB0cnVlICk7XG5cblx0dmFyIHByZXZRdWVyeSA9ICcnO1xuXHR2bS5zZWFyY2ggPSBmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKCB2bS5zZWFyY2gucXVlcnkgPT09ICcnICkgcmV0dXJuO1xuXHRcdGlmICggcHJldlF1ZXJ5ICE9PSB2bS5zZWFyY2gucXVlcnkgKSB7XG5cdFx0XHRwcmV2UXVlcnkgPSB2bS5zZWFyY2gucXVlcnk7XG5cdFx0XHRUTURiLmNsZWFyU2VhcmNoKCk7XG5cdFx0XHRoZWxpeC5jbGVhckFsbCgpO1xuXHRcdFx0RU5HSU5FLnJlc2V0Q2FtZXJhKCk7XG5cdFx0fVxuXHRcdGlmICggJHN0YXRlLmN1cnJlbnQubmFtZSAhPT0gJ2hlbGl4JyApIHtcblx0XHRcdCRzdGF0ZS5nbyggJ2hlbGl4JyApO1xuXHRcdH1cblx0XHRUTURiLnNlYXJjaEJ5VGl0bGUoIHZtLnNlYXJjaCApO1xuXHR9O1xuXG5cdC8vIERFQlVHXG5cdHdpbmRvdy5TQ09QRSA9ICRzY29wZTtcblx0dm0uVE1EYiA9IFRNRGI7XG5cdHZtLmhlbGl4ID0gaGVsaXg7XG5cdHZtLkVOR0lORSA9IEVOR0lORTtcblx0dm0uU1RBVEUgPSAkc3RhdGU7XG5cblx0RVZULkVPUC5saXN0ZW4oIGZ1bmN0aW9uICgpIHtcblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3JlY2lldmVkIEVPUCBldmVudCEnICk7XG5cdH0gKTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnVE1EYicsIGZ1bmN0aW9uICggbG9nLCBUTURiICkge1xyXG5cclxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRhdHRycywgJGVsZW1lbnQgKSB7XHJcblxyXG5cdFx0VE1EYi5zZWFyY2hCeUlkKCBwYXJzZUludCggJHNjb3BlLm1vdmllSWQgKSApXHJcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblxyXG5cdFx0XHQvLyBsb2cuZGVidWcoICdpbmZvJywgJ2NvbGxlY3Rpb25JdGVtRGlyZWN0aXZlJywgcmVzICk7XHJcblx0XHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC93OTIvJyArIHJlcy5wb3N0ZXJfcGF0aDtcclxuXHRcdFx0JGVsZW1lbnQuY3NzKCB7XHJcblx0XHRcdFx0J3dpZHRoJzogJzEwMCUnLFxyXG5cdFx0XHRcdCdoZWlnaHQnOiAnMTAwJScsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtcmVwZWF0JzogJ25vLXJlcGVhdCcsXHJcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICcxMDAlIDEwMCUnLFxyXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknXHJcblx0XHRcdH0gKTtcclxuXHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2NvbGxlY3Rpb25JdGVtRGlyZWN0aXZlJywgZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdH1cclxuXHJcblx0cmV0dXJuIHtcclxuXHRcdHJlc3RyaWN0OiAnRScsXHJcblx0XHRyZXBsYWNlOiB0cnVlLFxyXG5cdFx0c2NvcGU6IHsgbW92aWVJZDogJ0AnIH0sXHJcblx0XHRjb250cm9sbGVyOiBjdHJsLFxyXG5cdFx0Y29udHJvbGxlckFzOiAnY2knLFxyXG5cdFx0dGVtcGxhdGU6ICc8ZGl2PjwvZGl2PidcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdtb3ZpZUNvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsICdFVlQnLFxyXG5mdW5jdGlvbiAoIGxvZywgbW92aWVDb2xsZWN0aW9uLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLCBFVlQgKSB7XHJcblxyXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQsICRhdHRycyApIHtcclxuXHJcblx0XHR2YXIgdm0gPSB0aGlzO1xyXG5cdFx0dm0ubW92aWVDb2xsZWN0aW9uID0gbW92aWVDb2xsZWN0aW9uO1xyXG5cdFx0dm0uY29sbGVjdGlvbk1vZGFsU2VydmljZSA9IGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2U7XHJcblxyXG5cdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xyXG5cclxuXHRcdHZtLm9wZW5FZGl0b3IgPSBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdHZtLmFkZGluZ05ld0NvbGxlY3Rpb24gPSB0cnVlO1xyXG5cdFx0fTtcclxuXHJcblx0XHR2bS5jbG9zZUVkaXRvciA9IGZ1bmN0aW9uICgpIHtcclxuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xyXG5cdFx0fTtcclxuXHJcblx0XHR2bS5jcmVhdGVOZXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRtb3ZpZUNvbGxlY3Rpb24uY3JlYXRlKCAkc2NvcGUubmV3Q29sbGVjdGlvbk5hbWUgKTtcclxuXHRcdFx0dm0uY2xvc2VFZGl0b3IoKTtcclxuXHRcdH07XHJcblxyXG5cdFx0dm0uYWRkVG9Db2xsZWN0aW9uID0gZnVuY3Rpb24gKCBtb3ZpZUlkLCBjb2xsZWN0aW9uTmFtZSApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdhZGRUb0NvbGxlY3Rpb246JywgbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKTtcclxuXHRcdFx0dmFyIHN1Y2Nlc3MgPSBtb3ZpZUNvbGxlY3Rpb24ucHVzaCggbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKTtcclxuXHRcdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdtb3ZpZUNvbGxlY3Rpb24ucHVzaCcsIHN1Y2Nlc3MgKTtcclxuXHRcdH07XHJcblxyXG5cdFx0Ly8gZGVmYXVsdCBjc3MgYXQgZGlyZWN0aXZlIGluaXRpYWxpemF0aW9uXHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xyXG5cclxuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxPcGVuLmxpc3RlbiggZnVuY3Rpb24gKCkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb25Nb2RhbE9wZW4nICk7XHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ3Zpc2libGUnIH0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UubGlzdGVuKCBmdW5jdGlvbiAoKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnICk7XHJcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ2hpZGRlbicgfSApO1xyXG5cdFx0fSApO1xyXG5cclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblxyXG5cdFx0cmVzdHJpY3Q6ICdFJyxcclxuXHRcdHNjb3BlOiB7fSxcclxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXHJcblx0XHRjb250cm9sbGVyQXM6ICdtb2RhbCcsXHJcblx0XHRyZXBsYWNlOiB0cnVlLFxyXG5cdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL2NvbGxlY3Rpb25Nb2RhbC5odG1sJ1xyXG5cclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFVlQnLCBmdW5jdGlvbiAoIGxvZywgRVZUICkge1xyXG5cclxuXHR2YXIgYWN0aXZlSXRlbSA9IG51bGw7XHJcblxyXG5cdGZ1bmN0aW9uIHNldEFjdGl2ZUl0ZW0oIGl0ZW0gKSB7XHJcblx0XHRhY3RpdmVJdGVtID0gaXRlbTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGdldEFjdGl2ZUl0ZW0oIGl0ZW0gKSB7XHJcblx0XHRyZXR1cm4gYWN0aXZlSXRlbTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIG9wZW4oKSB7XHJcblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsT3Blbi5lbWl0KCk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBjbG9zZSgpIHtcclxuXHRcdEVWVC5jb2xsZWN0aW9uTW9kYWxDbG9zZS5lbWl0KCk7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0c2V0QWN0aXZlSXRlbSxcclxuXHRcdGdldEFjdGl2ZUl0ZW0sXHJcblx0XHRvcGVuLFxyXG5cdFx0Y2xvc2VcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoIGxvZywgJHNjb3BlLCBhdXRoLCBtb3ZpZUNvbGxlY3Rpb24gKSAge1xyXG5cclxuXHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb25DdHJsJywgbW92aWVDb2xsZWN0aW9uLmdldENvbGxlY3Rpb24oKSApO1xyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0ubW92aWVDb2xsZWN0aW9uID0gbW92aWVDb2xsZWN0aW9uO1xyXG5cclxuXHR2bS52aWV3Q29sbGVjdGlvbiA9IGZ1bmN0aW9uICggY29sbGVjdGlvbiApIHtcclxuXHRcdGNvbnNvbGUubG9nKCBjb2xsZWN0aW9uICk7XHJcblx0XHQvKiBjYWxsIG1vdmllQ29sbGVjdGlvbi5mZXRjaEFsbCgpXHJcblx0XHRcdGNsZWFySGVsaXgoKVxyXG5cdFx0XHRjYWxsIG1ha2UgaGVsaXggdy8gZmV0Y2hlZCByZXN1bHRcclxuXHRcdFx0dWkgc3RhdGUgLT4gaGVsaXhcclxuXHRcdCovXHJcblx0fTtcclxuXHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VORFBPSU5UX1VSSScsICckaHR0cCcsICckcScsIGZ1bmN0aW9uICggbG9nLCBFTkRQT0lOVF9VUkksICRodHRwLCAkcSApIHtcclxuXHJcblx0dmFyIERCX0VORFBPSU5UID0gRU5EUE9JTlRfVVJJICsgJ2NvbGxlY3Rpb24nO1xyXG5cdHZhciBjb2xsZWN0aW9uID0gbnVsbDtcclxuXHJcblx0dmFyIGZ1bGxDb2xsZWN0aW9uID0gbnVsbDtcclxuXHJcblx0ZnVuY3Rpb24gY3JlYXRlKCBuYW1lICkge1xyXG5cdFx0Y29sbGVjdGlvbi5wdXNoKCB7IGNvbGxlY3Rpb25OYW1lOiBuYW1lLCBtb3ZpZXM6IFtdIH0gKTtcclxuXHRcdHB1dCgpO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gaXNFbXB0eSgpIHtcclxuXHRcdHJldHVybiBjb2xsZWN0aW9uLmxlbmd0aCA9PT0gMDtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIGZldGNoQWxsKCBjb2xsZWN0aW9uTmFtZSApIHtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZXNvbHZlQ29sbGVjdGlvbigpIHtcclxuXHJcblx0XHR2YXIgZGVmZXJyZWQgPSAkcS5kZWZlcigpO1xyXG5cclxuXHRcdGlmICggY29sbGVjdGlvbiAhPT0gbnVsbCApIHtcclxuXHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggY29sbGVjdGlvbiApO1xyXG5cdFx0fSBlbHNlIHtcclxuXHRcdFx0JGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCwgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcclxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb24ucmVzb2x2ZUNvbGxlY3Rpb24oKTonLCByZXMgKTtcclxuXHRcdFx0XHRcdGlmICggcmVzLmRhdGEgKSB7XHJcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSByZXMuZGF0YTtcclxuXHRcdFx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSBbXTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcclxuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdjb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk6JywgZXJyICk7XHJcblx0XHRcdFx0XHRkZWZlcnJlZC5yZWplY3QoIGVyciApO1xyXG5cdFx0XHRcdH0gKTtcclxuXHRcdH1cclxuXHJcblx0XHRyZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBoYXNJdGVtKCBpdGVtSWQsIHNvbWVDb2xsZWN0aW9uICkge1xyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XHJcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gc29tZUNvbGxlY3Rpb24gKSB7XHJcblx0XHRcdFx0Zm9yICggdmFyIGsgPSAwOyBrIDwgY29sbGVjdGlvbltpXS5tb3ZpZXMubGVuZ3RoOyBrICsrICkge1xyXG5cdFx0XHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLm1vdmllc1trXSA9PT0gaXRlbUlkICkge1xyXG5cdFx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdHJldHVybiBmYWxzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHB1dCgpIHtcclxuXHRcdCRodHRwLnB1dCggREJfRU5EUE9JTlQsIGNvbGxlY3Rpb24sIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXHJcblx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb24ucHV0KCk6JywgcmVzICk7XHJcblx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdjb2xsZWN0aW9uLnB1dCgpOicsIGVyciApO1xyXG5cdFx0XHR9ICk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBwdXNoKCBpdGVtSWQsIHRvQ29sbGVjdGlvbiApIHtcclxuXHRcdGlmICggaGFzSXRlbSggaXRlbUlkLCB0b0NvbGxlY3Rpb24gKSApIHtcclxuXHRcdFx0cmV0dXJuIGZhbHNlO1xyXG5cdFx0fVxyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XHJcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gdG9Db2xsZWN0aW9uICkge1xyXG5cdFx0XHRcdGNvbGxlY3Rpb25baV0ubW92aWVzLnB1c2goIGl0ZW1JZCApO1xyXG5cdFx0XHRcdHB1dCgpO1xyXG5cdFx0XHRcdHJldHVybiB0cnVlO1xyXG5cdFx0XHR9XHJcblx0XHR9XHJcblx0XHRyZXR1cm4gZmFsc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZW1vdmUoIGl0ZW1JZCwgaW5Db2xsZWN0aW9uICkge1xyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XHJcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gaW5Db2xsZWN0aW9uICkge1xyXG5cdFx0XHRcdGZvciAoIHZhciBrID0gMDsgayA8IGNvbGxlY3Rpb25baV0ubW92aWVzLmxlbmd0aDsgayArKyApIHtcclxuXHRcdFx0XHRcdGlmICggY29sbGVjdGlvbltpXS5tb3ZpZXNba10gPT09IGl0ZW1JZCApIHtcclxuXHRcdFx0XHRcdFx0dmFyIHJlbW92ZWQgPSBjb2xsZWN0aW9uW2ldLm1vdmllcy5zcGxpY2UoIGssIDEgKS5sZW5ndGg7XHJcblx0XHRcdFx0XHRcdHB1dCgpO1xyXG5cdFx0XHRcdFx0XHRyZXR1cm4gcmVtb3ZlZCAhPT0gMDtcclxuXHRcdFx0XHRcdH1cclxuXHRcdFx0XHR9XHJcblx0XHRcdH1cclxuXHRcdH1cclxuXHRcdHJldHVybiBmYWxzZTtcclxuXHR9XHJcblxyXG5cdGZ1bmN0aW9uIHJlbW92ZUNvbGxlY3Rpb24oIGNvbGxlY3Rpb25OYW1lICkge1xyXG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XHJcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gY29sbGVjdGlvbk5hbWUgKSB7XHJcblx0XHRcdFx0dmFyIHJlbW92ZWQgPSBjb2xsZWN0aW9uLnNwbGljZSggaSwgMSApLmxlbmd0aDtcclxuXHRcdFx0XHRwdXQoKTtcclxuXHRcdFx0XHRyZXR1cm4gcmVtb3ZlZCAhPT0gMDtcclxuXHRcdFx0fVxyXG5cdFx0fVxyXG5cdFx0cmV0dXJuIGZhbHNlO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc3luYygpIHtcclxuXHRcdC8vIHN5bmMgbG9jYWwgY29sZWxjdGlvbiB3LyBEQlxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gZ2V0Q29sbGVjdGlvbigpIHtcclxuXHRcdHJldHVybiBjb2xsZWN0aW9uO1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gX2NsZWFyKCkge1xyXG5cdFx0Y29sbGVjdGlvbiA9IG51bGw7XHJcblx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2xvY2FsIGNvbGxlY3Rpb24gY2xlYXJlZC4nICk7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0Z2V0Q29sbGVjdGlvbixcclxuXHRcdGNyZWF0ZSxcclxuXHRcdHB1c2gsXHJcblx0XHRwdXQsXHJcblx0XHRyZW1vdmUsXHJcblx0XHRyZW1vdmVDb2xsZWN0aW9uLFxyXG5cdFx0c3luYyxcclxuXHRcdF9jbGVhcixcclxuXHRcdHJlc29sdmVDb2xsZWN0aW9uLFxyXG5cdFx0aGFzSXRlbSxcclxuXHRcdGlzRW1wdHlcclxuXHR9O1xyXG5cclxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnVE1EYicsICckY2FjaGVGYWN0b3J5JywgJ21vdmllSXRlbScsICdjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlJywgJ21vdmllQ29sbGVjdGlvbicsXHJcbmZ1bmN0aW9uKCBsb2csICRzY29wZSwgVE1EYiwgJGNhY2hlRmFjdG9yeSwgbW92aWVJdGVtLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLCBtb3ZpZUNvbGxlY3Rpb24gKSB7XHJcblxyXG5cdHZhciB2bSA9IHRoaXM7XHJcblx0dm0ubW92aWVJdGVtID0gbW92aWVJdGVtOyAvLyBtb3ZpZUl0ZW0gaW5qZWN0ZWQgdmlhIHN0YXRlIHJlc29sdmVcclxuXHRsb2cuZGVidWcoICdjdHJsJywgJ21vdmllRGV0YWlsIGN0cmwgcmVzb2x2ZWQ6Jywgdm0ubW92aWVJdGVtICk7XHJcblxyXG5cdG1vdmllSXRlbS5mdWxsVGl0bGUgPSBtb3ZpZUl0ZW0udGl0bGU7XHJcblx0aWYgKCBtb3ZpZUl0ZW0udGl0bGUgIT09IG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSApIHtcclxuXHRcdG1vdmllSXRlbS5mdWxsVGl0bGUgPSBtb3ZpZUl0ZW0udGl0bGUgKyAnICgnICsgbW92aWVJdGVtLm9yaWdpbmFsX3RpdGxlICsgJyknO1xyXG5cdH1cclxuXHJcblx0aWYgKCBtb3ZpZUl0ZW0uYmFja2Ryb3BfcGF0aCApIHtcclxuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC9vcmlnaW5hbCcgKyBtb3ZpZUl0ZW0uYmFja2Ryb3BfcGF0aDtcclxuXHRcdCQoICcuYmFja2Ryb3AnICkuY3NzKCB7XHJcblx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknXHJcblx0XHR9ICk7XHJcblx0fVxyXG5cclxuXHR2bS5vcGVuQ29sbGVjdGlvbk1vZGFsID0gZnVuY3Rpb24gKCkge1xyXG5cdFx0Y29sbGVjdGlvbk1vZGFsU2VydmljZS5zZXRBY3RpdmVJdGVtKCBtb3ZpZUl0ZW0gKTtcclxuXHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2Uub3BlbigpO1xyXG5cdH07XHJcblxyXG59IF07XHJcbiJdfQ==
